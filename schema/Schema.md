
## Naming convention rules

|Component Type|Prefix|
|---|---|
|App|`APP_`|
|Flow|`FLOW_`|
|Table/List|`TABLE_`|
|Environment|`ENV_`|
|Role|`ROLE_`|
|Connector|`CONN_`|
|Variable|`ENVVAR_`|
|External System|`EXT_`|

## Architecture diagram format
```mermaid
flowchart LR

    USER[End User]

    subgraph PowerPlatform
        APP[APP_MainApplication]
        FLOW[FLOW_PrimaryAutomation]
    end

    subgraph DataSources
        DB[(Dataverse)]
        SP[(SharePoint)]
        SQL[(SQL Database)]
    end

    subgraph ExternalSystems
        EXT1[External API]
        EXT2[Email Service]
    end

    USER --> APP
    APP --> DB
    APP --> SP
    APP --> FLOW
    FLOW --> SQL
    FLOW --> EXT1
    FLOW --> EXT2

```


## Data model format
```mermaid
erDiagram

    %% ==============================
    %% CORE ENTITY
    %% ==============================

    PrimaryEntity {
        string PrimaryEntityID PK
        string Name
        string Status
        datetime CreatedOn
        string CreatedBy FK
        datetime ModifiedOn
        string ModifiedBy FK
    }

    %% ==============================
    %% CHILD ENTITY (1:N)
    %% ==============================

    ChildEntity {
        string ChildEntityID PK
        string PrimaryEntityID FK
        string Name
        string Description
        string OwnerID FK
        datetime CreatedOn
    }

    %% ==============================
    %% LOOKUP / REFERENCE TABLE
    %% ==============================

    LookupEntity {
        string LookupID PK
        string DisplayName
        string Category
        boolean IsActive
    }

    %% ==============================
    %% MANY-TO-MANY BRIDGE TABLE
    %% ==============================

    BridgeEntity {
        string BridgeID PK
        string PrimaryEntityID FK
        string SecondaryEntityID FK
        datetime LinkedOn
    }

    SecondaryEntity {
        string SecondaryEntityID PK
        string Name
        string Type
    }

    %% ==============================
    %% USER / OWNER MODEL
    %% ==============================

    UserEntity {
        string UserID PK
        string DisplayName
        string Email
        string RoleID FK
    }

    RoleEntity {
        string RoleID PK
        string RoleName
        string AccessLevel
    }

    %% ==============================
    %% RELATIONSHIPS
    %% ==============================

    PrimaryEntity ||--o{ ChildEntity : contains
    PrimaryEntity }o--|| LookupEntity : categorized_by
    PrimaryEntity }o--|| UserEntity : owned_by

    PrimaryEntity ||--o{ BridgeEntity : links
    SecondaryEntity ||--o{ BridgeEntity : participates_in

    UserEntity }o--|| RoleEntity : assigned_role

```

## Solution Component Map
```mermaid
flowchart TB

    SOLUTION
    SOLUTION --> APP_1
    SOLUTION --> FLOW_1
    SOLUTION --> FLOW_2
    SOLUTION --> TABLE_1
    SOLUTION --> TABLE_2
    SOLUTION --> ENV_VAR_1
    SOLUTION --> CONN_REF_1

```

## Flow Execution + Connector Dependency Map

```mermaid
flowchart TB

    %% ==============================
    %% TRIGGER SOURCE
    %% ==============================

    APP[APP_MainApplication]
    USER[End User]

    USER --> APP
    APP --> FLOW

    %% ==============================
    %% FLOW EXECUTION
    %% ==============================

    subgraph FLOW[FLOW_PrimaryAutomation]

        Trigger[Trigger: PowerApps]

        Validate[Validate Input]
        GetData[Retrieve Data]
        Process[Process Logic]
        Store[Update Data Source]
        Notify[Send Notification]

        Trigger --> Validate
        Validate --> GetData
        GetData --> Process
        Process --> Store
        Store --> Notify

    end

    %% ==============================
    %% CONNECTOR DEPENDENCIES
    %% ==============================

    Validate --> CONN_Dataverse
    GetData --> CONN_SQL
    Process --> CONN_HTTP
    Store --> CONN_SharePoint
    Notify --> CONN_Outlook

    %% ==============================
    %% EXTERNAL SYSTEM DEPENDENCIES
    %% ==============================

    CONN_HTTP --> EXT_ExternalAPI
    CONN_Outlook --> EXT_EmailService
    CONN_SQL --> EXT_SQLDatabase
```

