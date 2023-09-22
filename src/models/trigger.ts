export interface IRule {
    expression: string;
    message: string;
    days?: string[];
    time?: string | string[];
}

export interface ITrigger {
    match: string;
    rules: IRule[];
}

export const DefaultTrigger: ITrigger = {
    match: ".*",
    rules: [
        {
            expression: "false",
            message: ""
        }
    ]
};
