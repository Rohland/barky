import { humanizeDuration } from "./time";

const utilityFunctionDefinitions = [
    [humanizeNum, humanizeNum.name],
    [humanizeDuration, humanizeDuration.name]
];

const utilityFunctions = utilityFunctionDefinitions.map(x => x[0]);
const utilityFunctionNames: string [] = utilityFunctionDefinitions.map(x => x[1] as string);

function exec(code: string) {
    const func = new Function(...utilityFunctionNames, code);
    return func(...utilityFunctions);
}

export function renderTemplate(
    template: string,
    data: object) {
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
            result = exec(variableString + `;\nreturn ${ expression }`);
        } catch {
            result = exec(variableString + `;\nreturn ${ expression.toLowerCase() }`);
        }
        return result;
    });
}

function humanizeNum(num, digits = 2) {
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
