"use strict";
/*
 * Copyright (c) 2019. Taimos GmbH http://www.taimos.de
 */
Object.defineProperty(exports, "__esModule", { value: true });
const https = require("https");
const util = require("util");
exports.ASKInsight = (token, originalHandler) => {
    return (requestEnvelope, context, callback) => {
        const logger = new LogContext(token, requestEnvelope, context, callback);
        context.logger = logger;
        try {
            originalHandler(requestEnvelope, context, logger.callback());
        }
        catch (e) {
            console.error(e);
            logger.flush();
            logger.cleanup();
        }
    };
};
class LogContext {
    constructor(token, event, context, wrappedCallback) {
        this.token = token;
        const self = this;
        this.wrapCall('error', 'ERROR');
        this.wrapCall('info', 'INFO');
        this.wrapCall('log', 'DEBUG');
        this.wrapCall('warn', 'WARN');
        this._uncaughtExceptionHandler = (error) => {
            console.error(error);
            self.flush();
        };
        process.on('uncaughtException', this._uncaughtExceptionHandler);
        const done = context.done;
        context.done = (error, result) => {
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
            this._callback = (error, result) => {
                self.captureResponse(error, result);
                self.flush(() => {
                    self.cleanup();
                    wrappedCallback.call(this, error, result);
                });
            };
        }
    }
    static unwrapCall(name) {
        let originalCall = console[name];
        if (originalCall.original !== undefined) {
            originalCall = originalCall.original;
        }
        console[name] = originalCall;
    }
    callback() {
        return this._callback;
    }
    log(type, data, params, tags) {
        if (data instanceof Error) {
            this.logError(type, data, tags);
        }
        else if (typeof data === 'string') {
            let dataString = data;
            if (params !== undefined && params !== null) {
                const allParams = [data];
                for (const param of params) {
                    allParams.push(param);
                }
                dataString = util.format.apply(this, allParams);
            }
            this.invocation.logs.push(`${type}: ${dataString} - [${tags ? tags.join(', ') : ''}]`);
        }
        else {
            if (data === undefined) {
                data = null;
            }
            this.invocation.logs.push(`${type}: ${data} - [${tags ? tags.join(', ') : ''}]`);
        }
    }
    logError(type, error, tags) {
        let message = error.name + ': ' + error.message;
        if (error.code !== undefined) {
            message += ' code: ' + error.code;
        }
        if (error.syscall !== undefined) {
            message += ' syscall: ' + error.syscall;
        }
        this.invocation.logs.push(`${type}: ${message} - ${error.stack} - [${tags ? tags.join(', ') : ''}]`);
    }
    cleanup() {
        process.removeListener('uncaughtException', this._uncaughtExceptionHandler);
        LogContext.unwrapCall('error');
        LogContext.unwrapCall('info');
        LogContext.unwrapCall('log');
        LogContext.unwrapCall('warn');
    }
    flush(onFlush) {
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
        httpRequest.on('error', (error) => {
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
    captureResponse(error, result) {
        if (error !== undefined && error !== null) {
            this.invocation.error = error;
        }
        else {
            this.invocation.response = result;
        }
        this.invocation.duration = (new Date().getMilliseconds()) - this.startTimestamp.getMilliseconds();
    }
    wrapCall(name, type) {
        const self = this;
        let originalCall = console[name];
        if (originalCall.original !== undefined) {
            originalCall = originalCall.original;
        }
        const newCall = (data, ...argumentArray) => {
            self.log(type, data, argumentArray);
            originalCall.apply(console, [data, ...argumentArray]);
        };
        newCall.original = originalCall;
        console[name] = newCall;
    }
}
//# sourceMappingURL=index.js.map