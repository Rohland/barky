import { Result } from "../models/result";
import { IApp } from "../models/app";

export type Evaluator = (config: any) => Promise<EvaluatorResult>;
export type EvaluatorResult = {
    results: Result[],
    apps: IApp[],
    skippedApps?: IApp[]
};
