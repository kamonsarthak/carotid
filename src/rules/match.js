// Path patterns are small globs matched against the URL pathname (no query string):
//
//   /api/users    exact match
//   /api/*        one path segment       (/api/users, not /api/users/1)
//   /api/**       anything underneath    (/api, /api/users, /api/users/1)
//   **/*.png      any .png, at any depth

/** @param {string} pattern @returns {RegExp} */
export function compilePath(pattern) {
  let p = pattern.trim();
  if (!p.startsWith('/') && !p.startsWith('*')) p = '/' + p;

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch !== '*') {
      re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    } else if (p[i + 1] !== '*') {
      re += '[^/]*';
    } else {
      i++;
      if (re.endsWith('/') && i === p.length - 1) {
        // a trailing "/**" also matches the directory itself: /api/** matches /api
        re = re.slice(0, -1) + '(?:/.*)?';
      } else if (p[i + 1] === '/') {
        // "**/" matches zero or more whole segments
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    }
  }
  return new RegExp(`^${re}$`);
}

/** Strip the query string (and any fragment) from a request URL. */
export function pathnameOf(url = '/') {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}
