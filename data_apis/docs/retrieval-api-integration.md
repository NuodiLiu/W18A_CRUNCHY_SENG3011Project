# Retrieval API Integration Guide

Minimal usage guide for other teams.

## Base URLs

- API base: `https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com`
- Swagger UI: `https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com/api-docs`
- OpenAPI JSON: `https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com/api-docs.json`

## Endpoints

- `GET /api/v1/events`
- `GET /api/v1/events/{eventId}`
- `GET /api/v1/events/types`
- `GET /api/v1/events/stats`

## List Events

`GET /api/v1/events`

Query params:
- common: `dataset_type` (`esg|housing`), `limit` (default `50`), `offset` (default `0`)
- esg: `company_name`, `permid`, `metric_name`, `pillar`, `year_from`, `year_to`
- housing: `postcode`, `suburb`, `street_name`, `nature_of_property`

Example:

```bash
curl "https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com/api/v1/events?dataset_type=esg&company_name=TestCorp&limit=10&offset=0"
```

Response shape:

```json
{
  "events": [
    {
      "event_id": "evt-001",
      "time_object": { "timestamp": "2024-01-15T00:00:00Z", "timezone": "UTC" },
      "event_type": "esg_metric",
      "attribute": {}
    }
  ],
  "total": 2
}
```

## Get Event By ID

`GET /api/v1/events/{eventId}`

```bash
curl "https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com/api/v1/events/evt-001"
```

## Get Event Types

`GET /api/v1/events/types`

```bash
curl "https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com/api/v1/events/types"
```

## Get Event Stats

`GET /api/v1/events/stats`

`group_by` (optional):
- esg: `pillar`, `company_name`, `metric_year`, `industry`
- housing: `suburb`, `postcode`, `zoning`, `nature_of_property`, `primary_purpose`, `contract_year`

```bash
curl "https://2u61lwt28d.execute-api.ap-southeast-2.amazonaws.com/api/v1/events/stats?group_by=pillar"
```

## Error Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {}
  }
}
```

Common status codes: `400`, `404`, `500`.
