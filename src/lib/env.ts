/*
 in some environments, env vars with dashes aren't supported, or are converted to snake_case,
 so check all variants of a key when attempting to retrieve it
 */
export function getEnvVar(
    key: string,
    defaultValue: any = undefined): any {
    if (!key) {
        return defaultValue;
    }
    const variants = [
        key,
        key.replace(/_/g, '-'),
        key.replace(/-/g, '_')];
    let value = defaultValue;
    for (const variant of variants) {
        if (process.env[variant]) {
            value = process.env[variant];
            break;
        }
    }
    return value;
}

export function getEnvVarAsBoolean(
    key: string,
    defaultValue: boolean = false): boolean {
    const value = getEnvVar(key);
    if (value === undefined) {
        return defaultValue;
    }
    const truthyValues = ["1", "true", "y"];
    return truthyValues.includes(value.toLowerCase().trim());
}
