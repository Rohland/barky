import { IAlertConfig } from "./alert_configuration";

export interface IApp {
    name?: string;
    quiet?: boolean;
    timeout?: number;
    alert?: IAlertConfig;
}
