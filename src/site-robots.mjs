/** Conservative, source-qualified Googlebot reading of one current robots.txt.
 * This first profile admits literal URI prefixes and a terminal $ anchor.
 * Wildcards, malformed syntax and ambiguous encodings remain unknown rather
 * than being silently treated as permission. It is not Google's cached state.
 */
export function readRobotsAccess(observation, routeUrl, userAgent = 'Googlebot') {
  const unknown = reason => ({allowed:null,reason,userAgent,rules:[]});
  if (!observation || observation.httpStatus === null) return unknown('robots-response-unobserved');
  if (observation.redirected || observation.finalUrl && observation.finalUrl !== observation.url)
    return unknown('robots-source-unobserved');
  if (observation.httpStatus >= 400 && observation.httpStatus < 500 && observation.httpStatus !== 429)
    return {allowed:true,reason:'robots-file-unavailable-4xx',userAgent,rules:[]};
  if (observation.httpStatus !== 200) return unknown('robots-response-not-complete-200');
  if (observation.bodyTruncated || typeof observation.body !== 'string') return unknown('robots-body-incomplete');
  if (!/^text\/plain(?:\s*;|$)/i.test(header(observation,'content-type') ?? '')) return unknown('robots-plain-text-unobserved');
  if (Buffer.byteLength(observation.body) > 512_000) return unknown('robots-profile-byte-limit');
  const groups = []; let group = null, beganRules = false, ruleCount = 0;
  for (const original of observation.body.replace(/^\uFEFF/,'').split(/\r\n|\r|\n/)) {
    const line = original.split('#',1)[0].trim();
    if (!line) continue;
    if (line.length > 2048 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/u.test(line)) return unknown('robots-profile-syntax-unsupported');
    const colon = line.indexOf(':');
    if (colon < 1) return unknown('robots-profile-syntax-unsupported');
    const field = line.slice(0,colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!/^(?:\*|[a-z_-]+)$/i.test(value)) return unknown('robots-profile-agent-unsupported');
      if (!group || beganRules) { group = {agents:[],rules:[]}; groups.push(group); beganRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (!group) return unknown('robots-rule-without-agent');
      beganRules = true;
      if (!value) continue;
      group.rules.push({field,path:value});
      ruleCount++;
    }
    if (groups.length > 512 || ruleCount > 4096)
      return unknown('robots-profile-rule-limit');
  }
  const agent = userAgent.toLowerCase();
  const specific = groups.filter(value => value.agents.includes(agent));
  const selected = specific.length ? specific : groups.filter(value => value.agents.includes('*'));
  const route = new URL(routeUrl);
  if (route.pathname === '/robots.txt' && !route.search) return {allowed:true,reason:'robots-resource-implicitly-allowed',userAgent,rules:[]};
  let target;
  try { target = normalizePath(route.pathname + route.search); }
  catch { return unknown('robots-profile-encoding-unsupported'); }
  const matches = [];
  for (const rule of selected.flatMap(value => value.rules)) {
    if (!rule.path.startsWith('/') || rule.path.includes('*') || /\s/u.test(rule.path)) return unknown('robots-profile-pattern-unsupported');
    const exact = rule.path.endsWith('$');
    const literal = exact ? rule.path.slice(0,-1) : rule.path;
    if (literal.includes('$')) return unknown('robots-profile-pattern-unsupported');
    let path;
    try { path = normalizePath(literal); }
    catch { return unknown('robots-profile-encoding-unsupported'); }
    // Google includes the terminal anchor in rule-path specificity. Removing
    // it for matching must not turn an exact disallow into an allow-tie.
    if (exact ? target === path : target.startsWith(path)) matches.push({...rule,specificity:octets(path) + (exact ? 1 : 0)});
  }
  const most = Math.max(0,...matches.map(value => value.specificity));
  const winning = matches.filter(value => value.specificity === most);
  return {allowed:winning.length === 0 || winning.some(value => value.field === 'allow'),
    reason:winning.length ? 'robots-matching-rule' : 'robots-no-matching-restriction',userAgent,rules:winning};
}

function normalizePath(value) {
  if (/%(?![\da-f]{2})/i.test(value)) throw new TypeError('malformed percent encoding');
  // RFC 9309 Figure 6: encoded literal %2A/%24 patterns match raw * and $
  // characters in the target URI. Pattern wildcards/terminal anchors have
  // already been distinguished before this literal normalization step.
  return [...value].map(char => char === '*' ? '%2A' : char === '$' ? '%24' : char.codePointAt(0) > 127 ? encodeURIComponent(char) : char).join('')
    .replace(/%([\da-f]{2})/gi,(_match,hex) => {
      const char = String.fromCharCode(Number.parseInt(hex,16));
      return /[a-z\d._~-]/i.test(char) ? char : `%${hex.toUpperCase()}`;
    });
}
function octets(value) { return Buffer.byteLength(value.replace(/%[\dA-F]{2}/g,'_')); }
function header(value,name) { const key = Object.keys(value.headers ?? {}).find(key => key.toLowerCase() === name); return key ? String(value.headers[key]) : null; }
