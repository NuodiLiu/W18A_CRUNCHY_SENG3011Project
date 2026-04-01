# Retrieval API Integration Guide

面向其他 team 的最小调用说明（基于当前代码实现）。

## Base URL

- Local: `http://localhost:3000`
- Swagger: `http://localhost:3000/api-docs`
- OpenAPI JSON: `http://localhost:3000/api-docs.json`

## Endpoints

1. `GET /api/v1/events`
2. `GET /api/v1/events/{eventId}`
3. `GET /api/v1/events/types`
4. `GET /api/v1/events/stats`

## 1) List Events

`GET /api/v1/events`

### Query Parameters

- Common
  - `dataset_type`: `esg` | `housing`
  - `limit`: number, default `50`
  - `offset`: number, default `0`
- ESG filters
  - `company_name` (partial match, case-insensitive)
  - `permid` (exact)
  - `metric_name` (partial match, case-insensitive)
  - `pillar` (exact, e.g. `Environmental`)
  - `year_from` (metric_year >=)
  - `year_to` (metric_year <=)
- Housing filters
  - `postcode` (exact)
  - `suburb` (partial match, case-insensitive)
  - `street_name` (partial match, case-insensitive)
  - `nature_of_property` (exact)

### Response

```json
{
  "events": [
    {
      "event_id": "evt-001",
      "time_object": {
        "timestamp": "2024-01-15T00:00:00Z",
        "timezone": "UTC"
      },
      "event_type": "esg_metric",
      "attribute": {
        "company_name": "TestCorp",
        "permid": "P12345",
        "metric_name": "carbon_emissions",
        "pillar": "Environmental",
        "metric_year": 2023
      }
    }
  ],
  "total": 2
}
```

### Example

```bash
curl "http://localhost:3000/api/v1/events?dataset_type=esg&company_name=TestCorp&limit=10&offset=0"
```

## 2) Get Event By ID

`GET /api/v1/events/{eventId}`

### Success Response

```json
{
  "event_id": "evt-001",
  "time_object": {
    "timestamp": "2024-01-15T00:00:00Z",
    "timezone": "UTC"
  },
  "event_type": "esg_metric",
  "attribute": {}
}
```

### 404 Response

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Event not found: evt-nonexistent"
  }
}
```

### Example

```bash
curl "http://localhost:3000/api/v1/events/evt-001"
```

## 3) Get Distinct Event Types

`GET /api/v1/events/types`

### Response

```json
{
  "event_types": ["esg_metric", "housing_sale"]
}
```

### Example

```bash
curl "http://localhost:3000/api/v1/events/types"
```

## 4) Get Event Stats

`GET /api/v1/events/stats`

### Query Parameter

- `group_by` (optional)
  - ESG: `pillar`, `company_name`, `metric_year`, `industry`
  - Housing: `suburb`, `postcode`, `zoning`, `nature_of_property`, `primary_purpose`, `contract_year`

### Response

```json
{
  "total_events": 3,
  "groups": [
    { "key": "Environmental", "count": 2 },
    { "key": "Social", "count": 1 }
  ]
}
```

### Example

```bash
curl "http://localhost:3000/api/v1/events/stats?group_by=pillar"
```

## Error Format

所有错误返回统一格式：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {}
  }
}
```

常见状态码：

- `400` 参数校验失败
- `404` 资源不存在（如 eventId 不存在）
- `500` 服务内部错误

## Notes For Integrators

- 当前 retrieval 接口不要求鉴权头（按当前服务实现）。
- 数字参数（如 `limit`, `offset`, `postcode`, `year_from`）请传可解析为 number 的值。
- `events` 查询支持 ESG 和 Housing 混合过滤；建议按 `dataset_type` 先分流再加领域过滤条件。
