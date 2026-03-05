/* tslint:disable */
/* eslint-disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import type { TsoaRoute } from '@tsoa/runtime';
import {  fetchMiddlewares, ExpressTemplateService } from '@tsoa/runtime';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PreprocessingController } from './../controllers/PreprocessingController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { HealthController } from './../controllers/HealthController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { EventsController } from './../controllers/EventsController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { CollectionController } from './../controllers/CollectionController';
import { iocContainer } from './../ioc';
import type { IocContainer, IocContainerFactory } from '@tsoa/runtime';
import type { Request as ExRequest, Response as ExResponse, RequestHandler, Router } from 'express';



// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

const models: TsoaRoute.Models = {
    "PreprocessJobAccepted": {
        "dataType": "refObject",
        "properties": {
            "job_id": {"dataType":"string","required":true},
            "status_url": {"dataType":"string","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ErrorBody": {
        "dataType": "refObject",
        "properties": {
            "error": {"dataType":"nestedObjectLiteral","nestedProperties":{"details":{"dataType":"any"},"message":{"dataType":"string","required":true},"code":{"dataType":"string","required":true}},"required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Record_string.unknown_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{},"additionalProperties":{"dataType":"any"},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PreprocessJobRequest": {
        "dataType": "refObject",
        "properties": {
            "input_s3_uri": {"dataType":"string","required":true},
            "pipeline": {"dataType":"string","required":true},
            "params": {"ref":"Record_string.unknown_"},
            "idempotency_key": {"dataType":"string"},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PreprocessJobStatusValue": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["pending"]},{"dataType":"enum","enums":["running"]},{"dataType":"enum","enums":["succeeded"]},{"dataType":"enum","enums":["failed"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PreprocessJobStatusResponse": {
        "dataType": "refObject",
        "properties": {
            "job_id": {"dataType":"string","required":true},
            "status": {"ref":"PreprocessJobStatusValue","required":true},
            "pipeline": {"dataType":"string","required":true},
            "input_s3_uri": {"dataType":"string","required":true},
            "output_s3_uri": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "manifest_uri": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "quality_report_uri": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "error": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "created_at": {"dataType":"string","required":true},
            "updated_at": {"dataType":"string","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PipelineParamsSchema": {
        "dataType": "refObject",
        "properties": {
        },
        "additionalProperties": {"dataType":"any"},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PipelineTemplate": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
            "description": {"dataType":"string","required":true},
            "category": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["general"]},{"dataType":"enum","enums":["time_series"]},{"dataType":"enum","enums":["text"]},{"dataType":"enum","enums":["esg"]}],"required":true},
            "params_schema": {"ref":"PipelineParamsSchema","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PipelinesResponse": {
        "dataType": "refObject",
        "properties": {
            "pipelines": {"dataType":"array","array":{"dataType":"refObject","ref":"PipelineTemplate"},"required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "HealthResponse": {
        "dataType": "refObject",
        "properties": {
            "status": {"dataType":"string","required":true},
            "version": {"dataType":"string","required":true},
            "timestamp": {"dataType":"string","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TimeObjectResponse": {
        "dataType": "refObject",
        "properties": {
            "timestamp": {"dataType":"string","required":true},
            "timezone": {"dataType":"string","required":true},
            "duration": {"dataType":"double"},
            "duration_unit": {"dataType":"string"},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EsgMetricAttributeResponse": {
        "dataType": "refObject",
        "properties": {
            "permid": {"dataType":"string","required":true},
            "company_name": {"dataType":"string","required":true},
            "metric_name": {"dataType":"string","required":true},
            "metric_value": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "metric_year": {"dataType":"double","required":true},
            "metric_unit": {"dataType":"string","required":true},
            "metric_description": {"dataType":"string","required":true},
            "pillar": {"dataType":"string","required":true},
            "industry": {"dataType":"string","required":true},
            "headquarter_country": {"dataType":"string","required":true},
            "data_type": {"dataType":"string","required":true},
            "disclosure": {"dataType":"string","required":true},
            "provider_name": {"dataType":"string","required":true},
            "nb_points_of_observations": {"dataType":"union","subSchemas":[{"dataType":"double"},{"dataType":"enum","enums":[null]}],"required":true},
            "reported_date": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
            "metric_period": {"dataType":"union","subSchemas":[{"dataType":"string"},{"dataType":"enum","enums":[null]}],"required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EventRecordResponse": {
        "dataType": "refObject",
        "properties": {
            "time_object": {"ref":"TimeObjectResponse","required":true},
            "event_type": {"dataType":"string","required":true},
            "attribute": {"ref":"EsgMetricAttributeResponse","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EventDatasetResponse": {
        "dataType": "refObject",
        "properties": {
            "data_source": {"dataType":"string","required":true},
            "dataset_type": {"dataType":"string","required":true},
            "dataset_id": {"dataType":"string","required":true},
            "time_object": {"ref":"TimeObjectResponse","required":true},
            "events": {"dataType":"array","array":{"dataType":"refObject","ref":"EventRecordResponse"},"required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EventTypesResponse": {
        "dataType": "refObject",
        "properties": {
            "event_types": {"dataType":"array","array":{"dataType":"string"},"required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EventStatGroup": {
        "dataType": "refObject",
        "properties": {
            "key": {"dataType":"string","required":true},
            "count": {"dataType":"double","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EventStatsResponse": {
        "dataType": "refObject",
        "properties": {
            "total_events": {"dataType":"double","required":true},
            "groups": {"dataType":"array","array":{"dataType":"refObject","ref":"EventStatGroup"},"required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreateImportResponse": {
        "dataType": "refObject",
        "properties": {
            "job_id": {"dataType":"string","required":true},
            "connection_id": {"dataType":"string","required":true},
            "status_url": {"dataType":"string","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SourceSpecBody": {
        "dataType": "refObject",
        "properties": {
            "s3_uris": {"dataType":"array","array":{"dataType":"string"}},
            "s3_prefix": {"dataType":"string"},
            "delimiter": {"dataType":"string"},
            "has_header": {"dataType":"boolean"},
            "timezone": {"dataType":"string","required":true},
            "time_column": {"dataType":"string"},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreateImportBody": {
        "dataType": "refObject",
        "properties": {
            "connector_type": {"dataType":"enum","enums":["esg_csv_batch"],"required":true},
            "source_spec": {"ref":"SourceSpecBody","required":true},
            "mapping_profile": {"dataType":"string","required":true},
            "data_source": {"dataType":"string","required":true},
            "dataset_type": {"dataType":"string","required":true},
            "ingestion_mode": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["incremental"]},{"dataType":"enum","enums":["full_refresh"]}],"required":true},
            "idempotency_key": {"dataType":"string"},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PresignResponse": {
        "dataType": "refObject",
        "properties": {
            "upload_url": {"dataType":"string","required":true},
            "s3_uri": {"dataType":"string","required":true},
            "expires_in": {"dataType":"double","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PresignRequestBody": {
        "dataType": "refObject",
        "properties": {
            "filename": {"dataType":"string","required":true},
            "content_type": {"dataType":"string","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "JobStatusResponse": {
        "dataType": "refObject",
        "properties": {
            "job_id": {"dataType":"string","required":true},
            "connection_id": {"dataType":"string","required":true},
            "status": {"dataType":"string","required":true},
            "config_ref": {"dataType":"string","required":true},
            "dataset_id": {"dataType":"string"},
            "error": {"dataType":"string"},
            "created_at": {"dataType":"string","required":true},
            "updated_at": {"dataType":"string","required":true},
        },
        "additionalProperties": true,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
};
const templateService = new ExpressTemplateService(models, {"noImplicitAdditionalProperties":"ignore","bodyCoercion":true});

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa




export function RegisterRoutes(app: Router) {

    // ###########################################################################################################
    //  NOTE: If you do not see routes for all of your controllers in this file, then you might not have informed tsoa of where to look
    //      Please look into the "controllerPathGlobs" config option described in the readme: https://github.com/lukeautry/tsoa
    // ###########################################################################################################


    
        const argsPreprocessingController_createJob: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"PreprocessJobRequest"},
        };
        app.post('/api/v1/preprocessing/jobs',
            ...(fetchMiddlewares<RequestHandler>(PreprocessingController)),
            ...(fetchMiddlewares<RequestHandler>(PreprocessingController.prototype.createJob)),

            async function PreprocessingController_createJob(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPreprocessingController_createJob, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PreprocessingController>(PreprocessingController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'createJob',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 202,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPreprocessingController_getJob: Record<string, TsoaRoute.ParameterSchema> = {
                jobId: {"in":"path","name":"jobId","required":true,"dataType":"string"},
        };
        app.get('/api/v1/preprocessing/jobs/:jobId',
            ...(fetchMiddlewares<RequestHandler>(PreprocessingController)),
            ...(fetchMiddlewares<RequestHandler>(PreprocessingController.prototype.getJob)),

            async function PreprocessingController_getJob(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPreprocessingController_getJob, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PreprocessingController>(PreprocessingController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getJob',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPreprocessingController_getPipelines: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.get('/api/v1/preprocessing/pipelines',
            ...(fetchMiddlewares<RequestHandler>(PreprocessingController)),
            ...(fetchMiddlewares<RequestHandler>(PreprocessingController.prototype.getPipelines)),

            async function PreprocessingController_getPipelines(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPreprocessingController_getPipelines, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PreprocessingController>(PreprocessingController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getPipelines',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsHealthController_getHealth: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.get('/health',
            ...(fetchMiddlewares<RequestHandler>(HealthController)),
            ...(fetchMiddlewares<RequestHandler>(HealthController.prototype.getHealth)),

            async function HealthController_getHealth(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsHealthController_getHealth, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<HealthController>(HealthController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getHealth',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsEventsController_getEvents: Record<string, TsoaRoute.ParameterSchema> = {
                company_name: {"in":"query","name":"company_name","dataType":"string"},
                permid: {"in":"query","name":"permid","dataType":"string"},
                metric_name: {"in":"query","name":"metric_name","dataType":"string"},
                pillar: {"in":"query","name":"pillar","dataType":"string"},
                year_from: {"in":"query","name":"year_from","dataType":"double"},
                year_to: {"in":"query","name":"year_to","dataType":"double"},
                limit: {"default":50,"in":"query","name":"limit","dataType":"double"},
                offset: {"default":0,"in":"query","name":"offset","dataType":"double"},
        };
        app.get('/api/v1/events',
            ...(fetchMiddlewares<RequestHandler>(EventsController)),
            ...(fetchMiddlewares<RequestHandler>(EventsController.prototype.getEvents)),

            async function EventsController_getEvents(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsEventsController_getEvents, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<EventsController>(EventsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getEvents',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsEventsController_getEventTypes: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.get('/api/v1/events/types',
            ...(fetchMiddlewares<RequestHandler>(EventsController)),
            ...(fetchMiddlewares<RequestHandler>(EventsController.prototype.getEventTypes)),

            async function EventsController_getEventTypes(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsEventsController_getEventTypes, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<EventsController>(EventsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getEventTypes',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsEventsController_getEventStats: Record<string, TsoaRoute.ParameterSchema> = {
                group_by: {"in":"query","name":"group_by","dataType":"string"},
        };
        app.get('/api/v1/events/stats',
            ...(fetchMiddlewares<RequestHandler>(EventsController)),
            ...(fetchMiddlewares<RequestHandler>(EventsController.prototype.getEventStats)),

            async function EventsController_getEventStats(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsEventsController_getEventStats, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<EventsController>(EventsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getEventStats',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsEventsController_getEventById: Record<string, TsoaRoute.ParameterSchema> = {
                eventId: {"in":"path","name":"eventId","required":true,"dataType":"string"},
        };
        app.get('/api/v1/events/:eventId',
            ...(fetchMiddlewares<RequestHandler>(EventsController)),
            ...(fetchMiddlewares<RequestHandler>(EventsController.prototype.getEventById)),

            async function EventsController_getEventById(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsEventsController_getEventById, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<EventsController>(EventsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getEventById',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsCollectionController_createImport: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"CreateImportBody"},
        };
        app.post('/api/v1/collection/imports',
            ...(fetchMiddlewares<RequestHandler>(CollectionController)),
            ...(fetchMiddlewares<RequestHandler>(CollectionController.prototype.createImport)),

            async function CollectionController_createImport(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsCollectionController_createImport, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<CollectionController>(CollectionController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'createImport',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 202,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsCollectionController_presignUpload: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"PresignRequestBody"},
        };
        app.post('/api/v1/collection/uploads/presign',
            ...(fetchMiddlewares<RequestHandler>(CollectionController)),
            ...(fetchMiddlewares<RequestHandler>(CollectionController.prototype.presignUpload)),

            async function CollectionController_presignUpload(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsCollectionController_presignUpload, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<CollectionController>(CollectionController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'presignUpload',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsCollectionController_getJobStatus: Record<string, TsoaRoute.ParameterSchema> = {
                jobId: {"in":"path","name":"jobId","required":true,"dataType":"string"},
        };
        app.get('/api/v1/collection/jobs/:jobId',
            ...(fetchMiddlewares<RequestHandler>(CollectionController)),
            ...(fetchMiddlewares<RequestHandler>(CollectionController.prototype.getJobStatus)),

            async function CollectionController_getJobStatus(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsCollectionController_getJobStatus, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<CollectionController>(CollectionController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getJobStatus',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa


    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
}

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
