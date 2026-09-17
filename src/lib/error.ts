// a cause chain longer than this is a loop, or a wrapper that has lost the plot either way
const MaxCauseDepth = 10;

/*
 An error's message together with the messages of whatever caused it.

 Barky wraps errors as they pass through retries and channels, and only the outermost message is
 ever printed - which is how "Error executing posting to slack after 3 attempts" reaches an
 operator with the one detail they need, the reason slack gave, still sitting inside it.
 */
export function describeError(err: any, depth: number = 0): string {
    if (err === null || err === undefined || depth > MaxCauseDepth) {
        return "";
    }
    const message = messageOf(err);
    const cause = describeError(err?.cause, depth + 1);
    return cause && !message.includes(cause)
        ? `${ message }: ${ cause }`
        : message;
}

function messageOf(err: any): string {
    if (typeof err === "string") {
        return err;
    }
    const message = err?.message;
    if (typeof message === "string" && message.length > 0) {
        return message;
    }
    try {
        return String(err);
    } catch {
        // a thrown object whose toString itself throws - there is nothing left to say about it
        return "";
    }
}
