// Outgoing diagnostics are data. Redact before storing, formatting or serializing them.
export function makeRedactor(values: readonly string[] = []): (text: string) => string {
	const secrets = [...new Set(values.filter(v => v.length >= 8))].sort((a,b) => b.length-a.length);
	return (text: string): string => {
		for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]');
		return text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [REDACTED]')
			.replace(/\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
			.replace(/((?:VOLT_BRIDGE_TOKEN|RIFT_TOKEN|\.ROBLOSECURITY)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
			.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
	};
}

export function redactValue<T>(value: T, redact: (text: string) => string): T {
	const visit=(entry:unknown):unknown=>{
		if(typeof entry==='string')return redact(entry);
		if(Array.isArray(entry))return entry.map(visit);
		if(entry&&typeof entry==='object')return Object.fromEntries(Object.entries(entry).map(([key,v])=>[redact(key),visit(v)]));
		return entry;
	};
	return visit(value) as T;
}
