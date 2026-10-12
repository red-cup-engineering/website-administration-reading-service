import path from "node:path";
import ts from "typescript";

const strings = (value) => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
const inside = (file, root) => file === root || file.startsWith(`${root}/`);
const historical = (name) => /(?:^|\/)(?:legacy|archive|triage)(?:\/)|(?:^|\/)content\/text\//.test(name);

/** Derive roles from package-manager records, compiler mappings, test commands,
 * and the shared engines' real dependency/export graph. Names alone never
 * exempt an application; the receiving page/server remains its own obligation.
 * @param {Map<string, object>} files @param {Map<string, object>} manifests
 * @param {string[]} engines
 * @returns {{installed:Map<string,object>,testOutputs:Map<string,object>,upstream:Map<string,object>,engineModules:Map<string,object>,diagnostics:object[]}}
 */
export function deriveWebSourceRoles(files, manifests, engines) {
  const installed = new Map(), testOutputs = new Map(), upstream = new Map(), engineModules = new Map(), diagnostics = [], buildMappings = [];
  for (const file of files.values()) {
    if (!file.text) continue;
    if (path.posix.basename(file.path) === "lake-manifest.json") {
      let declaration;
      try { declaration = JSON.parse(file.text); } catch { diagnostics.push({ path: file.path, reason: "invalid-dependency-manifest" }); continue; }
      if (typeof declaration.packagesDir !== "string" || !Array.isArray(declaration.packages)) continue;
      for (const dependency of declaration.packages) {
        if (dependency.type !== "git" || typeof dependency.name !== "string" || typeof dependency.url !== "string" || typeof dependency.rev !== "string") continue;
        const root = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), declaration.packagesDir, dependency.name));
        if (root.startsWith("../") || path.posix.isAbsolute(root)) continue;
        for (const target of files.values()) if (inside(target.path, root)) installed.set(target.path, { manifest: file.path, name: dependency.name, url: dependency.url, revision: dependency.rev });
      }
    }
    if (/\/tsconfig(?:\.[^/]+)?\.json$|^tsconfig(?:\.[^/]+)?\.json$/.test(file.path)) {
      const parsed = ts.parseConfigFileTextToJson(file.path, file.text);
      if (parsed.error) { diagnostics.push({ path: file.path, reason: "invalid-compiler-configuration" }); continue; }
      const { outDir, rootDir } = parsed.config?.compilerOptions ?? {};
      if (typeof outDir !== "string" || typeof rootDir !== "string") continue;
      const root = path.posix.dirname(file.path), manifest = manifests.get(root);
      if (!manifest) continue;
      const out = path.posix.normalize(path.posix.join(root, outDir)), source = path.posix.normalize(path.posix.join(root, rootDir));
      const configuration = path.posix.relative(root, file.path);
      const commands = Object.entries(manifest.scripts ?? {}).filter(([, command]) => typeof command === "string" && command.includes(configuration) && /\btsc\b/.test(command));
      if (!commands.length) continue;
      const mapping = { manifest: path.posix.join(root, "package.json"), configuration: file.path, out, source };
      buildMappings.push(mapping);
      const testCommand = manifest.scripts?.test;
      if (typeof testCommand === "string" && testCommand.includes(outDir) && commands.every(([name]) => /^(?:pretest|test)(?::|$)/.test(name))) {
        for (const target of files.values()) if (inside(target.path, out)) testOutputs.set(target.path, { ...mapping, testCommand });
      }
    }
  }
  const byName = new Map();
  for (const [root, manifest] of manifests) if (typeof manifest.name === "string" && !historical(root + "/") && !installed.has(path.posix.join(root, "package.json"))) {
    if (!byName.has(manifest.name)) byName.set(manifest.name, []);
    byName.get(manifest.name).push({ root, manifest });
  }
  const reached = new Map(), queue = engines.map((name) => ({ name, chain: [name] }));
  while (queue.length) {
    const next = queue.shift();
    if (reached.has(next.name)) continue;
    reached.set(next.name, next.chain);
    for (const pkg of byName.get(next.name) ?? []) for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) queue.push({ name: dependency, chain: [...next.chain, dependency] });
  }
  const sourceForOutput = (name) => {
    const candidates = [];
    for (const mapping of buildMappings) if (inside(name, mapping.out)) {
      const base = path.posix.join(mapping.source, path.posix.relative(mapping.out, name));
      for (const source of [base, base.replace(/\.mjs$/, ".mts"), base.replace(/\.cjs$/, ".cts"), base.replace(/\.js$/, ".ts")]) if (files.has(source)) candidates.push(source);
    }
    return candidates;
  };
  for (const [name, dependencyChain] of reached) {
    for (const pkg of byName.get(name) ?? []) {
      const entries = strings(pkg.manifest.exports ?? pkg.manifest.main).filter((entry) => /\.[cm]?[jt]s$/.test(entry) && !/\.d\.[cm]?ts$/.test(entry));
      for (const entry of entries) {
        const target = path.posix.normalize(path.posix.join(pkg.root, entry)), visited = new Set(), pending = [target, ...sourceForOutput(target)];
        while (pending.length) {
          const current = pending.pop(), file = files.get(current);
          if (!file?.source || visited.has(current) || !inside(current, pkg.root)) continue;
          visited.add(current);
          (engines.includes(name) ? engineModules : upstream).set(current, { manifest: path.posix.join(pkg.root, "package.json"), export: entry, dependencyChain });
          pending.push(...file.dependencies, ...sourceForOutput(current));
        }
      }
    }
  }
  return { installed, testOutputs, upstream, engineModules, diagnostics };
}
