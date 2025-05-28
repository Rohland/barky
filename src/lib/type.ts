export function formatType(value: any) {
    const returnAsIs = [null, undefined, ""];
    if (returnAsIs.includes(value)) {
        return value;
    }
    const num = Number(value);
    if (isNaN(num)) {
        return value;
    }
    if (Number.isInteger(num)){
        return num;
    }
    return parseFloat(num.toFixed(3));
}
