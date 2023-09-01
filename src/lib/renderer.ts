export interface ITemplateOptions {
    humanizeNumbers?: boolean;
}

export function renderTemplate(template, data, options: ITemplateOptions = null) {
    if (!template || template.trim().length === 0) {
        return "";
    }
    if (!data) {
        return template;
    }
    const dataWithLoweredKeys = Object.fromEntries(
        Object.entries(data ?? {})
            .map(([k, v]) => [k.toLowerCase(), v]));
    return template.replace(/{{([^}]*)}}/g, (_, v) => {
        const value = dataWithLoweredKeys[v.toLowerCase().trim()];
        if (options?.humanizeNumbers) {
            return nFormatter(value, 2);
        }
        return value;
    });
}

function nFormatter(num, digits) {
    const number = parseFloat(num);
    if (isNaN(number)){
        return num;
    }
    const absolute = Math.abs(number);
    const sign = Math.sign(number);
    const lookup = [
        { value: 1, symbol: "" },
        { value: 1e3, symbol: "k" },
        { value: 1e6, symbol: "M" },
    ];
    const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    const item = lookup.slice().reverse().find(function(item) {
        return absolute >= item.value;
    });
    return item ? (sign * absolute / item.value).toFixed(digits).replace(rx, "$1") + item.symbol : num;
}
