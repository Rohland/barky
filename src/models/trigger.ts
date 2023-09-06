export interface IRule {
    expression: string;
    message: string;
}

export const DefaultTrigger = {
    match: ".*",
    rules: [
        {
            expression: "false",
            message: ""
        }
    ]
};
