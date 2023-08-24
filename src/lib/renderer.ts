export function renderTemplate(template, data) {
    if (!template || template.trim().length === 0) {
        return "";
    }
    if (!data) {
        return template;
    }
    const dataWithLoweredKeys = Object.fromEntries(
        Object.entries(data ?? {})
            .map(([k, v]) => [k.toLowerCase(), v]));
    return template.replace(/{{([^}]*)}}/g, (_, v) => dataWithLoweredKeys[v.toLowerCase().trim()]);
}
