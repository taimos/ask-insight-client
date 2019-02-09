/*
 * Copyright (c) 2019. Taimos GmbH http://www.taimos.de
 */

import {LambdaHandler} from 'ask-sdk-core/dist/skill/factory/BaseSkillFactory';
import {RequestEnvelope} from 'ask-sdk-model';
import * as https from 'https';
import * as util from 'util';

export const ASKInsight = (token : string, originalHandler : LambdaHandler) : LambdaHandler => {
    return (requestEnvelope : RequestEnvelope, context : any, callback : (err : Error, result? : any) => void) : void => {
        const logger = new LogContext(token, requestEnvelope, context, callback);
        context.logger = logger;
        try {
            originalHandler(requestEnvelope, context, logger.callback());
        } catch (e) {
            console.error(e);
            logger.flush();
            logger.cleanup();
        }
    };
};

interface Invocation {
    id : string;
    skillId : string;
    timestamp : string;
    request? : RequestEnvelope;
    response? : Response;
    error? : object;
    duration? : number;
    logs : string[];
}

class LogContext {

    private static unwrapCall(name : string) : void {
        let originalCall = (<any>console)[name];
        if (originalCall.original !== undefined) {
            originalCall = originalCall.original;
        }
        console[name] = originalCall;
    }

    private readonly _callback : (err : Error, result? : any) => void;
    private readonly _uncaughtExceptionHandler : (Error : any) => void;
    private readonly invocation : Invocation;
    private readonly startTimestamp : Date;

    public constructor(private token : string, event : RequestEnvelope, context : any, wrappedCallback : (err : Error, result? : any) => void) {
        const self = this;

        this.wrapCall('error', 'ERROR');
        this.wrapCall('info', 'INFO');
        this.wrapCall('log', 'DEBUG');
        this.wrapCall('warn', 'WARN');

        this._uncaughtExceptionHandler = (error : Error) : void => {
            console.error(error);
            self.flush();
        };
        process.on('uncaughtException', this._uncaughtExceptionHandler);

        const done = context.done;
        context.done = (error : Error, result? : any) : void => {
            self.captureResponse(error, result);
            self.flush(() => {
                self.cleanup();
                done.call(context, error, result);
            });
        };

        this.startTimestamp = new Date();
        this.invocation = {
            id: context.awsRequestId,
            skillId: event.session.application.applicationId,
            timestamp: this.startTimestamp.toISOString(),
            request: event,
            logs: [],
        };

        if (wrappedCallback !== undefined && wrappedCallback !== null) {
            this._callback = (error : Error, result? : any) : void => {
                self.captureResponse(error, result);
                self.flush(() => {
                    self.cleanup();
                    wrappedCallback.call(this, error, result);
                });
            };
        }
    }

    public callback() : (err : Error, result? : any) => void {
        return this._callback;
    }

    public log(type : string, data : any, params? : any[], tags? : string[]) : void {
        if (data instanceof Error) {
            this.logError(type, <Error>data, tags);
        } else if (typeof data === 'string') {
            let dataString = data;
            if (params !== undefined && params !== null) {
                const allParams = [data];
                for (const param of params) {
                    allParams.push(param);
                }
                dataString = util.format.apply(this, allParams);
            }
            this.invocation.logs.push(`${type}: ${dataString} - [${tags ? tags.join(', ') : ''}]`);

        } else {
            if (data === undefined) {
                data = null;
            }
            this.invocation.logs.push(`${type}: ${data} - [${tags ? tags.join(', ') : ''}]`);
        }
    }

    public logError(type : string, error : any, tags? : string[]) : void {
        let message = error.name + ': ' + error.message;
        if (error.code !== undefined) {
            message += ' code: ' + error.code;
        }

        if (error.syscall !== undefined) {
            message += ' syscall: ' + error.syscall;
        }
        this.invocation.logs.push(`${type}: ${message} - ${error.stack} - [${tags ? tags.join(', ') : ''}]`);
    }

    public cleanup() : void {
        process.removeListener('uncaughtException', this._uncaughtExceptionHandler);
        LogContext.unwrapCall('error');
        LogContext.unwrapCall('info');
        LogContext.unwrapCall('log');
        LogContext.unwrapCall('warn');
    }

    public flush(onFlush? : () => void) : void {
        const dataAsString = JSON.stringify(this.invocation);
        const dataLength = Buffer.byteLength(dataAsString);
        const options = {
            host: 'api.ask-insight.io',
            path: `/skills/${this.invocation.skillId}/invocations`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': dataLength,
                'Connection': 'keep-alive',
                'Authorization': this.token,
            },
        };

        const httpRequest = https.request(options);
        httpRequest.on('error', (error : Error) => {
            console.error(error.toString());
            if (onFlush) {
                onFlush();
            }
        });

        httpRequest.setNoDelay(true);
        httpRequest.end(dataAsString, null, () => {
            if (onFlush) {
                onFlush();
            }
        });
    }

    private captureResponse(error : Error, result : any) : void {
        if (error !== undefined && error !== null) {
            this.invocation.error = error;
        } else {
            this.invocation.response = result;
        }
        this.invocation.duration = (new Date().getMilliseconds()) - this.startTimestamp.getMilliseconds();
    }

    private wrapCall(name : string, type : string) : void {
        const self = this;
        let originalCall = (<any>console)[name];
        if (originalCall.original !== undefined) {
            originalCall = originalCall.original;
        }
        const newCall : any = (data, ...argumentArray) : void => {
            self.log(type, data, argumentArray);
            originalCall.apply(console, [data, ...argumentArray]);
        };
        newCall.original = originalCall;
        console[name] = newCall;
    }
}
