import { Result, SkippedResult } from "./models/result";
import path from "path";

function tryGetRuleName() {
    try {
        const rules = path.basename(process.argv[3]);
        const parts = rules.split(".");
        if (parts.length === 1) {
            return parts[0];
        }
        return parts.slice(0, parts.length - 1).join(".");
    } catch(err) {
        return "";
    }
}

export function emitResults(results: Result[]) {
    const rule = tryGetRuleName();
    results.forEach(x => {
        if (x.success && x.app?.quiet) {
            return;
        }
        if (x instanceof SkippedResult) {
            return;
        }
        const fields = [
            x
                .toString()
                ?.replace(/[\r\n]+/g, " "),
            rule
        ];
        console.log(fields.join("|"));
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
