import { Result } from "./models/result";

export function emitResults(results: Result[]) {
    results.forEach(x => {
        if (x.success && x.app?.quiet) {
            return;
        }
        const sValue = x.toString()?.replace(/[\r\n]+/g, " ");
        console.log(sValue);
    });
}

function extractErrorString(
    errors,
    errorString,
    separatorLength,
    maxPossibleLength) {
    let errorsEmitted = 0;
    for (const error of errors) {
        if (errorString.length + error.length + separatorLength > maxPossibleLength) {
            const errorsRemaining = errors.length - errorsEmitted;
            errorString += ` & ${errorsRemaining} other${errorsRemaining > 1 ? "s" : ""}`;
            break;
        }
        const separator = errorsEmitted === 0 ? "" : ", ";
        errorString += separator + error;
        errorsEmitted++;
    }
    return errorString;
}

export function prepareResults(results) {
    let errorString = "";
    const errors = results.filter(r => r && r.trim().length > 0);
    if (errors.length === 0){
        return errorString;
    }
    const maxChars = 100;
    const postFixLength = 12;
    const maxPossibleLength = maxChars - postFixLength;
    const separatorLength = 2;
    return extractErrorString(
        errors,
        errorString,
        separatorLength,
        maxPossibleLength);
}
