# 数据流图谱

> 生成时间:  | 链路数: 21 | 节点数: 1

## 请求链路

### Admin

> API: admin

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Agents

> API: agents

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Approvals

> API: approvals

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Auth

> API: auth

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Conversations

> API: conversations

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Dashboard

> API: dashboard

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Events

> API: events

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Files

> API: files

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Git Audit

> API: git_audit

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Hooks

> API: hooks

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Kanban

> API: kanban

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Knowledge

> API: knowledge

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Lark Bridge

> API: lark_bridge

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Lark Callback

> API: lark_callback

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Plans

> API: plans

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Project Groups

> API: project_groups

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Project Members

> API: project_members

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Projects

> API: projects

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Remote Agents

> API: remote_agents

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

### Rules

> API: rules

```mermaid
sequenceDiagram
    Client->>API: HTTP Request
    API->>Service: 处理请求
    Service->>DB: 查询数据库
    DB->>Service: 返回结果
    Service->>API: 返回响应
```

## 异步流程

### WebSocket 推送

**触发**: 状态变更

- 事件发布
- WebSocket Hub
- 推送到客户端

## 外部集成

### 飞书

- **方向**: 
- **协议**: 
