// Compares a numeric JSON field against warn/fail limits.
const {
  STATUS_ARG_URL: url,
  STATUS_ARG_FIELD: field,
  STATUS_ARG_WARN_ABOVE: warn,
  STATUS_ARG_FAIL_ABOVE: fail,
  STATUS_ARG_BEARER_TOKEN: token,
  STATUS_ARG_VERSION_FIELD: versionField,
} = process.env;

let version;
const report = (status, message, latency) => {
  console.log(JSON.stringify({ status, message, latency_ms: latency, ...(version ? { version } : {}) }));
  process.exit(status === 'up' ? 0 : status === 'degraded' ? 2 : 1);
};
const read = (obj, path) => path.split('.').reduce((acc, key) => acc?.[key], obj);

const started = performance.now();
try {
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  const latency = Math.round(performance.now() - started);
  if (!res.ok) report('down', `HTTP ${res.status}`, latency);
  const json = await res.json();
  if (versionField) {
    const v = read(json, versionField);
    if (v !== undefined && v !== null) version = String(v);
  }
  const value = Number(read(json, field));
  if (Number.isNaN(value)) report('down', `${field} is not a number`, latency);
  if (fail !== undefined && value > Number(fail))
    report('down', `${field} = ${value} (fail above ${fail})`, latency);
  if (warn !== undefined && value > Number(warn))
    report('degraded', `${field} = ${value} (warn above ${warn})`, latency);
  report('up', `${field} = ${value}`, latency);
} catch (error) {
  report('down', error.message, Math.round(performance.now() - started));
}
