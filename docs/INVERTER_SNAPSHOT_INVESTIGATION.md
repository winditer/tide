# 工作项 9aca652d-8677-4cbb-8d4e-3f7db6a43d04
# 逆变器快照（Inverter Snapshot）功能 - 双应用实现调研报告

**调研时间**: 2025年7月17日  
**调研范围**: fms-server 和 redback-job 两个项目  
**调研深度**: 代码级别对比分析  

---

## 摘要

用户工作项涉及"逆变器快照"功能需求，调研发现该功能的相关定时任务代码确实同时存在于 fms-server 和 redback-job 两个项目中。这**不是简单的重复实现**，而是基于 **FMS双应用架构设计** 的合理分工，但同时也存在一些需要注意的设计问题。

---

## 一、架构背景

### FMS采用双应用定时任务架构

根据项目知识库记忆：

```
FMS系统 = fms-server + redback-job

fms-server (FMS核心业务服务)
├─ 13个定时任务Job
├─ 职责: 设备充电检测、升级检查、电池匹配检测
└─ 特点: 与主业务紧耦合，处理FMS产品特定逻辑

redback-job (Redback平台级定时任务服务)
├─ 30+个定时任务Job
├─ 职责: 系统报告、固件告警、设备更新、数据维护
└─ 特点: 跨产线运维监控能力，属于基础设施层
```

**分离的好处**:
- 故障隔离：一个应用问题不影响另一个
- 资源隔离：高频任务不会耗尽业务应用资源
- 弹性扩展：独立部署、独立扩容
- 版本独立：各自独立发布和回滚

---

## 二、逆变器快照功能实现对比

### 2.1 fms-server 中的实现

#### InverterTelemetryJob.java
**文件路径**: `/Users/haifeng/Documents/FMS/fms-server/src/main/java/com/ebon/energy/fms/job/InverterTelemetryJob.java`

| 属性 | 值 |
|-----|-----|
| 类型 | @Service (定时任务) |
| 执行频率 | 每15分钟 |
| Cron表达式 | `10 0/15 * * * ?` |
| 核心职责 | 设备遥测数据落库任务 |
| 线程模型 | 20线程并发（CompletableFuture） |

**关键代码片段**:
```java
@Scheduled(cron = "10 0/15 * * * ?") // 每15分钟执行一次，第10秒开始
public void processTelemetry() throws ExecutionException, InterruptedException {
    // 1. 查询所有设备的SN和最后接收状态时间
    List<RedbackProductsDO> records = productMapper.selectSnAndLastDate();
    
    // 2. 分页处理（3000条/页）
    List<List<RedbackProductsDO>> batches = Lists.partition(records, PAGE_SIZE);
    for (List<RedbackProductsDO> batch : batches) {
        // 3. 并发查询TableStore遥测数据（20线程线程池）
        CompletableFuture<InverterTelemetryDO> aliyunFuture = 
            CompletableFuture.supplyAsync(() -> {
                RossTelemetry telemetry = tableStoreServiceFactory.getTelemetry(
                    product.getRedbackProductSn(), 
                    product.getLastSystemStatusReceived().getTime() / 1000
                );
                // 4. 转换并返回
                return convertToInverterTelemetryDO(telemetry);
            }, telemetryExecutorService);
    }
    
    // 5. 等待所有线程完成（600秒超时）
    List<InverterTelemetryDO> telemetrys = getTelemetryList(futures);
    
    // 6. 批量存储到InverterTelemetry表
    telemetryService.saveInverterTelemetryBatch(telemetrys);
}
```

**特点**:
- 直接从Aliyun TableStore查询遥测数据
- 高性能并发（20线程）
- 存储到 InverterTelemetry 表（历史数据表）
- 与FMS业务紧密相关

#### InverterSnapshotService.java
**文件路径**: `/Users/haifeng/Documents/FMS/fms-server/src/main/java/com/ebon/energy/fms/service/InverterSnapshotService.java`

| 属性 | 值 |
|-----|-----|
| 类型 | @Service (非定时，被调用的Service) |
| 执行方式 | 手动触发或其他Service调用 |
| 核心职责 | 逆变器快照同步 |
| 数据范围 | 300秒内最后修改的SN |

**关键代码片段**:
```java
public void inverterSync() {
    // 1. 使用分布式锁（重要！）
    boolean b = cacheDataService.acquireLock(
        "InverterSnapshotSync", "1", 120  // 120秒超时
    );
    if (!b) return; // 已有实例在处理
    
    try {
        // 2. 追踪CRM变更
        inverterTrackingMapper.crmTrackInverterChanges();
        
        // 3. 加载暂存区数据
        loadInverterStaging();
        
        // 4. 从暂存区更新主表
        snapshotExternalStagingMapper.updateInverterFromStaging();
        
    } finally {
        // 释放锁
        cacheDataService.deleteCache("InverterSnapshotSync");
    }
}

private void loadInverterStaging() {
    // 查询300秒内最后修改的SN
    List<String> sns = inverterTrackingMapper.selectSnsByLastModified(300);
    
    // 清空暂存表
    snapshotExternalStagingMapper.truncateTable();
    
    // 分批处理（100条/批）
    if (CollectionUtils.isNotEmpty(sns)) {
        List<List<String>> batches = Lists.partition(sns, 100);
        for (List<String> batch : batches) {
            snapshotExternalStagingMapper.loadInverterStagingBySns(snsStr);
        }
        // 删除重复
        snapshotExternalStagingMapper.deleteDuplicates();
    }
}
```

**特点**:
- 非定时任务，被其他Service调用
- 使用分布式锁保护（120秒超时）
- 通过CRM追踪设备变更
- 使用暂存表中转数据
- 查询范围较小（300秒）

---

### 2.2 redback-job 中的实现

#### GenerateSnapshotJob.java
**文件路径**: `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/job/GenerateSnapshotJob.java`

| 属性 | 值 |
|-----|-----|
| 类型 | @Component (定时任务) |
| 执行频率 | 每10分钟 |
| Cron表达式 | `0 0/10 * * * ?` |
| 核心职责 | 快照生成与同步 |
| 执行步骤 | 4个步骤的协调 |

**关键代码片段**:
```java
@Component
@Slf4j
public class GenerateSnapshotJob {
    @Scheduled(cron = "0 0/10 * * * ?")  // 每10分钟执行
    public void generateSnapshot() {
        log.info("start GenerateSnapshot");
        
        // 步骤1: 更新设备ID
        invertersMapper.updateDeviceId();
        
        // 步骤2: 更新小时级在线状态
        invertersMapper.updateIsHourlyOnline();
        
        // 步骤3: 更新日级在线状态
        invertersMapper.updateIsDailyOnline();
        
        // 步骤4: 触发快照同步
        inverterSnapshotService.inverterSync();
        
        log.info("GenerateSnapshot finished");
    }
}
```

**特点**:
- 定时任务，每10分钟执行
- 是快照生成的协调者
- 包含在线状态维护逻辑
- 最后触发 inverterSnapshotService.inverterSync()

#### UpdateInverterStatusJob.java
**文件路径**: `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/job/UpdateInverterStatusJob.java`

| 属性 | 值 |
|-----|-----|
| 类型 | @Component (定时任务) |
| 执行频率 | 每1分钟 |
| Cron表达式 | `0 0/1 * * * ?` |
| 核心职责 | 设备在线状态实时更新 |

**关键代码片段**:
```java
@Component
@Slf4j
public class UpdateInverterStatusJob {
    @Scheduled(cron = "0 0/1 * * * ?")  // 每分钟执行
    public void updateInverterStatus() {
        log.info("updateInverterStatus start");
        
        long startTime = System.currentTimeMillis();
        
        // 查询设备状态
        List<RedbackProductsExtDO> redbackProductsExts = 
            productMapper.selectInverterStatus();
        
        // 批量保存更新
        productService.saveInverterStatusBatch(redbackProductsExts);
        
        log.info("updateInverterStatus finished, 耗时: {} ms", 
                 System.currentTimeMillis() - startTime);
    }
}
```

**特点**:
- 高频执行（每分钟）
- 只负责状态更新
- 简单轻量级逻辑
- 用于平台级监控

#### InverterSnapshotService.java (redback-job版本)
**文件路径**: `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/service/InverterSnapshotService.java`

| 属性 | 值 |
|-----|-----|
| 类型 | @Service |
| 执行方式 | 被GenerateSnapshotJob调用 |
| 核心职责 | 快照同步核心逻辑 |
| 数据范围 | 600秒内最后修改的SN |

**关键代码片段**:
```java
public void inverterSync() {
    // 1. 获取同一把锁（注意：与fms-server使用相同的锁名！）
    boolean b = cacheDataMapper.tryAcquireLock(
        INVERTER_SNAPSHOT_SYNC_KEY, "1", 120
    );
    if (!b) return;
    
    try {
        long startTime = System.currentTimeMillis();
        
        // 2. 追踪CRM变更
        inverterTrackingMapper.crmTrackInverterChanges();
        
        // 3. 调用Staging Service处理
        inverterSnapshotExternalStagingService.inverterSnapshotExternalStaging();
        
    } catch (Exception e) {
        log.error("inverterSync 执行失败", e);
    } finally {
        cacheDataMapper.deleteCache(INVERTER_SNAPSHOT_SYNC_KEY);
    }
}
```

#### InverterSnapshotExternalStagingService.java
**文件路径**: `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/service/InverterSnapshotExternalStagingService.java`

**关键代码片段**:
```java
public void inverterSnapshotExternalStaging() {
    try {
        loadInverterStaging();
        snapshotExternalStagingMapper.updateInverterFromStaging();
        // 额外功能：监控狗更新（redback-job特有）
        snapshotExternalStagingMapper.updateInverterWatchdogFromDeviceTool();
    } catch (Exception e) {
        log.error("inverterSnapshotExternalStaging error", e);
    }
}

public void loadInverterStaging() {
    // 查询600秒内最后修改的SN（比fms-server的300秒范围更大）
    List<String> sns = inverterTrackingMapper.selectSnsByLastModified(600);
    
    // 后续逻辑与fms-server类似
    snapshotExternalStagingMapper.truncateTable();
    
    if (CollectionUtils.isNotEmpty(sns)) {
        List<List<String>> batches = Lists.partition(sns, 100);
        for (List<String> batch : batches) {
            snapshotExternalStagingMapper.loadInverterStagingBySns(snsStr);
        }
        snapshotExternalStagingMapper.deleteDuplicates();
    }
}
```

**特点**:
- 查询范围更大（600秒）
- 包含手表狗更新逻辑
- 处理流程相似但有差异

---

## 三、执行流程与时间线

### 执行时间线示意

```
时间      fms-server                    redback-job
─────────────────────────────────────────────────────────
00:00     (无)                          GenerateSnapshotJob启动
                                        ├─ updateDeviceId()
                                        ├─ updateIsHourlyOnline()
                                        ├─ updateIsDailyOnline()
                                        └─ inverterSnapshotService.inverterSync()
                                           (获取INVERTER_SNAPSHOT_SYNC_KEY锁)
          
00:01     (无)                          UpdateInverterStatusJob启动
                                        ├─ selectInverterStatus()
                                        └─ saveInverterStatusBatch()

00:02     (无)                          (无)

...

00:10     InverterTelemetryJob启动       GenerateSnapshotJob启动
          ├─ selectSnAndLastDate()      ├─ updateDeviceId()
          ├─ 20线程并发查询TableStore   ├─ updateIsHourlyOnline()
          └─ saveInverterTelemetryBatch() ├─ updateIsDailyOnline()
                                        └─ inverterSnapshotService.inverterSync()
                                           (尝试获取INVERTER_SNAPSHOT_SYNC_KEY锁)
          
          可能的冲突场景:
          同一时刻两个应用都要修改Inverters表！
```

### 执行频率对比

| 应用 | Job名称 | 频率 | Cron表达式 |
|-----|--------|------|----------|
| fms-server | InverterTelemetryJob | 每15分钟 | `10 0/15 * * * ?` |
| redback-job | GenerateSnapshotJob | 每10分钟 | `0 0/10 * * * ?` |
| redback-job | UpdateInverterStatusJob | 每1分钟 | `0 0/1 * * * ?` |

---

## 四、关键对比分析

### 4.1 职责与分工

#### fms-server 职责（FMS核心业务）

| 组件 | 职责 | 特点 |
|-----|------|------|
| **InverterTelemetryJob** | 遥测数据采集与存储 | 高并发（20线程）、直接集成TableStore、15分钟频率 |
| **InverterSnapshotService** | 逆变器信息快照同步 | 使用分布式锁、300秒范围、被调用式 |

**总体特点**: 面向**实时数据采集**，高性能处理

#### redback-job 职责（Redback平台级服务）

| 组件 | 职责 | 特点 |
|-----|------|------|
| **GenerateSnapshotJob** | 快照生成协调 | 10分钟频率、包含在线状态维护 |
| **UpdateInverterStatusJob** | 状态实时更新 | 高频（1分钟）、轻量级 |
| **InverterSnapshotExternalStagingService** | 暂存区管理 | 600秒范围、手表狗机制 |

**总体特点**: 面向**平台级监控**，关注状态维护和运维监控

### 4.2 代码重复性

#### 重复的部分（相同逻辑）

1. **分布式锁**
   ```
   fms-server: cacheDataService.acquireLock(INVERTER_SNAPSHOT_SYNC_KEY, ...)
   redback-job: cacheDataMapper.tryAcquireLock(INVERTER_SNAPSHOT_SYNC_KEY, ...)
   → 使用同一把锁！可能产生竞争
   ```

2. **CRM变更追踪**
   ```
   两者都调用: inverterTrackingMapper.crmTrackInverterChanges()
   ```

3. **暂存区处理**
   ```
   两者都调用: snapshotExternalStagingMapper.updateInverterFromStaging()
   ```

4. **批处理策略**
   ```
   两者都采用: 100条/批的分批处理
   ```

#### 互补的部分（不同职责）

1. **遥测数据处理**
   ```
   仅fms-server做: 直接查询TableStore、20线程并发
   ```

2. **在线状态维护**
   ```
   仅redback-job做: updateIsHourlyOnline()、updateIsDailyOnline()、UpdateInverterStatusJob
   ```

3. **监控狗机制**
   ```
   仅redback-job做: updateInverterWatchdogFromDeviceTool()
   ```

### 4.3 数据处理范围

| 指标 | fms-server | redback-job | 差异 |
|-----|-----------|-----------|------|
| 查询范围 | 300秒 | 600秒 | redback-job更宽泛 |
| 批处理大小 | 100条/批 | 100条/批 | 相同 |
| 锁超时 | 120秒 | 120秒 | 相同 |
| 修改表 | InverterTelemetry | Inverters + Inverters_watchdog | redback-job范围更大 |

### 4.4 并发处理

**fms-server**:
```java
// 使用CompletableFuture进行并发查询
ExecutorService telemetryExecutorService = Executors.newFixedThreadPool(20);
CompletableFuture<InverterTelemetryDO> future = 
    CompletableFuture.supplyAsync(() -> {...}, telemetryExecutorService);

特点: 高并发、异步处理、超时控制（600秒）
```

**redback-job**:
```java
// 同步串行执行
public void generateSnapshot() {
    invertersMapper.updateDeviceId();
    invertersMapper.updateIsHourlyOnline();
    invertersMapper.updateIsDailyOnline();
    inverterSnapshotService.inverterSync();
}

特点: 低并发、同步处理、步骤串行
```

---

## 五、潜在问题与风险

### 问题 1: 分布式锁冲突

**严重程度**: ⚠ 中等

**问题描述**:
两个应用使用**完全相同的锁名称** `INVERTER_SNAPSHOT_SYNC_KEY`，如果部署在同一个Redis实例，会导致锁竞争。

**冲突场景**:
```
T+0:10  GenerateSnapshotJob获取锁，开始处理快照
        ├─ 更新DeviceId (1秒)
        ├─ 更新IsHourlyOnline (5秒)
        ├─ 更新IsDailyOnline (3秒)
        └─ inverterSnapshotService.inverterSync() (95秒)
           
T+0:10  (同时刻) 如果有fms-server的其他服务也想调用 inverterSync()
        → 尝试获取同一把锁
        → 被拒绝，返回
        
T+0:11  如果GenerateSnapshotJob处理超过120秒（锁超时时间）
        → 锁自动释放
        → 下一个竞争者立即获取
        → 同一条记录被处理两次
```

**后果**:
- 数据可能被重复处理
- 可能导致数据冲突和不一致
- 在高并发场景下易出现竞态条件

**修复方案**:
```java
// 使用应用标识前缀区分
fms-server:    INVERTER_SNAPSHOT_SYNC_KEY:fms-server
redback-job:   INVERTER_SNAPSHOT_SYNC_KEY:redback-job

或者引入应用标识:
cacheDataService.acquireLock(
    INVERTER_SNAPSHOT_SYNC_KEY + ":" + applicationName, 
    uniqueId, 
    120
);
```

### 问题 2: 执行频率不统一

**严重程度**: ⚠ 低-中等

**问题描述**:
三个定时任务的执行频率分别为15分钟、10分钟、1分钟，高峰期会同时竞争同一把锁。

**高峰期分析**:
```
T+0:00  三个任务都不执行
T+0:01  UpdateInverterStatusJob执行 (每分钟)
T+0:02  UpdateInverterStatusJob执行
...
T+0:10  GenerateSnapshotJob执行 (每10分钟) ✓
        UpdateInverterStatusJob执行 (每分钟) ✓
        同时修改状态！
        
T+0:15  InverterTelemetryJob执行 (每15分钟) ✓
        GenerateSnapshotJob执行 (下一个10分钟周期) ✓
        UpdateInverterStatusJob执行 (每分钟) ✓
        三个Job同时执行！
```

**后果**:
- 资源竞争
- 锁等待导致业务延迟
- 执行时间难以预测

### 问题 3: 查询范围不一致

**严重程度**: ⚠ 低

**问题描述**:
fms-server查询300秒内的变更，redback-job查询600秒内的变更。

**后果**:
- fms-server可能遗漏掉300-600秒之间的变更
- 数据覆盖范围不一致

**场景**:
```
T+0:00   设备A发生变更
T+0:05   GenerateSnapshotJob执行
         ├─ 从600秒内加载: 包含设备A ✓
         └─ 处理成功

T+0:15   InverterTelemetryJob执行
         ├─ 从300秒内加载: 不包含设备A (已超过300秒) ✗
         └─ 遗漏处理

结果: 数据更新不一致
```

### 问题 4: 数据修改冲突

**严重程度**: ⚠ 中等

**问题描述**:
两个应用同时修改同一个表（Inverters）中的不同字段。

**冲突场景**:
```
SQL Level:
UPDATE Inverters SET 
    lastTelemetry = '...',      ← fms-server在修改
    isOnlineHourly = true       ← redback-job在修改
WHERE id = ?;

可能的结果:
1. fms-server先提交: Inverters表有 lastTelemetry，但isOnlineHourly丢失
2. redback-job先提交: Inverters表有 isOnlineHourly，但lastTelemetry丢失
3. 两者同时修改导致其中一方的修改丢失
```

### 问题 5: 重复处理

**严重程度**: ⚠ 中等

**问题描述**:
`crmTrackInverterChanges()` 被调用多次，同一条变更记录可能被处理多次。

**场景**:
```
T+0:00  设备A状态变更被记录到CRM表

T+0:10  GenerateSnapshotJob执行
        → crmTrackInverterChanges() 处理设备A ✓

T+0:10  (同时或稍后) fms-server其他Service调用inverterSync()
        → crmTrackInverterChanges() 再次处理设备A ✗

结果: 同一个变更被处理两次，可能导致状态翻转或数据不一致
```

---

## 六、是否重复实现？

### 结论

**部分重复，部分互补。这是一个有意的设计，但存在优化空间。**

### 详细分析

#### 重复的部分（业务逻辑重复）

1. **CRM变更追踪**
   - 两个应用都调用 `crmTrackInverterChanges()`
   - 可以考虑合并或事件通知

2. **分布式锁保护**
   - 都使用同一把锁，容易产生竞争
   - 应该根据应用标识区分

3. **暂存区处理**
   - 都调用 `updateInverterFromStaging()`
   - 都使用相同的批处理策略

#### 互补的部分（职责分工）

1. **fms-server**:
   - 专注**遥测数据采集** (InverterTelemetryJob)
   - 高并发处理能力
   - 业务层面的快照同步

2. **redback-job**:
   - 专注**状态维护与监控** (UpdateInverterStatusJob, GenerateSnapshotJob)
   - 包含在线状态统计
   - 包含监控狗机制
   - 平台层面的监控与运维

### 设计评价

**优点**:
- 职责清晰（业务层 vs 平台层）
- 故障隔离（一个应用故障不影响另一个）
- 资源隔离（独立部署和扩展）

**缺点**:
- 代码存在重复（同一个CRM变更追踪逻辑）
- 分布式锁管理不够精细
- 缺乏明确的协调机制
- 数据处理范围不一致

---

## 七、具体文件位置总结

### fms-server 相关文件

| 文件 | 路径 | 行数 | 用途 |
|-----|------|------|------|
| InverterTelemetryJob.java | `/Users/haifeng/Documents/FMS/fms-server/src/main/java/com/ebon/energy/fms/job/InverterTelemetryJob.java` | 211 | 遥测数据采集 |
| InverterSnapshotService.java | `/Users/haifeng/Documents/FMS/fms-server/src/main/java/com/ebon/energy/fms/service/InverterSnapshotService.java` | 78 | 快照同步服务 |
| InverterSnapshotExternalStagingMapper.java | `/Users/haifeng/Documents/FMS/fms-server/src/main/java/com/ebon/energy/fms/mapper/second/InverterSnapshotExternalStagingMapper.java` | - | 暂存区映射 |

### redback-job 相关文件

| 文件 | 路径 | 行数 | 用途 |
|-----|------|------|------|
| GenerateSnapshotJob.java | `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/job/GenerateSnapshotJob.java` | 35 | 快照生成定时任务 |
| UpdateInverterStatusJob.java | `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/job/UpdateInverterStatusJob.java` | 37 | 状态更新定时任务 |
| InverterSnapshotService.java | `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/service/InverterSnapshotService.java` | 45 | 快照同步服务 |
| InverterSnapshotExternalStagingService.java | `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/service/InverterSnapshotExternalStagingService.java` | 62 | 暂存区管理服务 |
| InverterSnapshotExternalStagingMapper.java | `/Users/haifeng/Documents/FMS/redback-job/src/main/java/com/ebon/energy/redback/mapper/second/InverterSnapshotExternalStagingMapper.java` | - | 暂存区映射 |

---

## 八、建议

### 立即行动 (本周)

1. **验证分布式锁**
   - 检查两个应用是否使用同一个Redis实例
   - 监控INVERTER_SNAPSHOT_SYNC_KEY锁的获取/释放日志
   - 检查是否存在锁超时的情况

2. **检查数据一致性**
   - 对比fms-server和redback-job最近生成的快照数据
   - 查看Inverters表中的重复更新记录
   - 检查最近7天的Job执行日志，查看冲突情况

3. **添加监控**
   - 监控三个Job的执行时间（是否存在超过120秒）
   - 监控锁的竞争情况
   - 设置告警（如果发现数据冲突或不一致）

### 短期优化 (1-2周)

1. **统一执行频率**
   ```
   建议方案:
   - UpdateInverterStatusJob: 每1分钟 (保持不变 - 高频监控)
   - GenerateSnapshotJob: 改为每20分钟 (避免与InverterTelemetryJob冲突)
   - InverterTelemetryJob: 保持每15分钟
   ```

2. **精细化分布式锁**
   ```java
   // 使用应用标识前缀
   const String INVERTER_SNAPSHOT_SYNC_KEY_FMS = 
       "InverterSnapshotSync:fms-server";
   const String INVERTER_SNAPSHOT_SYNC_KEY_REDBACK = 
       "InverterSnapshotSync:redback-job";
   ```

3. **统一查询范围**
   ```java
   // 两个应用都使用600秒范围，确保覆盖
   inverterTrackingMapper.selectSnsByLastModified(600);
   ```

### 中期重构 (1个月)

1. **引入事件驱动架构**
   - fms-server发生变更时发布事件
   - redback-job订阅事件
   - 避免重复调用 crmTrackInverterChanges()

2. **建立统一的快照同步服务**
   - 创建独立的 InverterSnapshotSyncService
   - 由两个应用共享调用
   - 统一管理分布式锁和数据范围

3. **明确数据修改权限**
   - fms-server: 负责遥测数据字段
   - redback-job: 负责状态字段
   - 分离SQL UPDATE语句，避免冲突

### 长期优化 (3个月+)

1. **微服务化**
   - 抽离为独立的 inverter-snapshot-service
   - 由两个应用通过RPC调用
   - 统一版本管理和升级

2. **事件溯源 (Event Sourcing)**
   - 记录所有设备变更事件
   - 便于追踪谁修改了什么
   - 便于后续的审计和回滚

3. **更智能的调度**
   - 使用Quartz或APScheduler等分布式调度框架
   - 自动协调Job执行频率，避免冲突

---

## 九、总结

**工作项 9aca652d-8677-4cbb-8d4e-3f7db6a43d04 的"逆变器快照"功能代码确实同时存在于两个项目中，这是基于FMS双应用架构的合理设计，目的是实现故障隔离、资源隔离和独立扩展。**

然而，当前的实现存在以下问题需要改进：

1. **分布式锁竞争** - 可能导致重复处理
2. **执行频率不统一** - 高峰期资源竞争
3. **代码重复** - CRM变更追踪逻辑重复
4. **数据一致性风险** - 同时修改同一表的不同字段

建议通过上述三阶段的改进方案来逐步优化这个设计。

