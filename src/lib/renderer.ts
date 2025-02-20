export interface ITemplateOptions {
    humanizeNumbers?: boolean;
}

export function renderTemplate(
    template,
    data: object,
    options: ITemplateOptions = null) {
    if (!template || template.trim().length === 0) {
        return "";
    }
    if (!data) {
        return template;
    }

    const usedKeys = new Set();
    const keys = Object.keys(data);

    const variables = keys.map(key => {
        const varValue = JSON.stringify(data[key]);
        usedKeys.add(key);
        return `let ${ key } = ${ varValue };`;
    });

    keys.forEach(key => {
        const loweredKey = key.toLowerCase();
        if (usedKeys.has(loweredKey)) {
            return;
        }
        usedKeys.add(loweredKey);
        const value = JSON.stringify(data[key]);
        variables.push(`let ${ loweredKey } = ${ value };`);
    });
    const variableString = variables.join("\n");

    return template.replace(/{{([^}]*)}}/g, (_, v) => {
        const expression = v.trim();
        let result;
        try {
            result = eval(`${ variableString }
            ${ expression }`);
        } catch {
            result = eval(`${ variableString }
            ${ expression.toLowerCase() }`);
        }
        if (options?.humanizeNumbers) {
            return nFormatter(result, 2);
        }
        return result;
    });
}

function nFormatter(num, digits) {
    const isNumber = /^[-+]?\d*\.?\d+$/.test(num || "");
    if (!isNumber) {
        return num;
    }
    const number = parseFloat(num);
    const absolute = Math.abs(number);
    const sign = Math.sign(number);
    const lookup = [
        { value: 1, symbol: "" },
        { value: 1e3, symbol: "k" },
        { value: 1e6, symbol: "M" },
    ];
    const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    const item = lookup.slice().reverse().find(function (item) {
        return absolute >= item.value;
    });
    return item ? (sign * absolute / item.value).toFixed(digits).replace(rx, "$1") + item.symbol : num;
}
