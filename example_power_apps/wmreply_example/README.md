## WMReply example Power App

### Overview
- **Solution metadata (`solution.xml`)** – declares the `Replybrary` solution lists every root component (canvas apps, flows, environment variables).
- **Component manifest (`customizations.xml`)** – central index showing two canvas apps, their SharePoint and Power Automate dependencies, and all connection references packaged in the solution.
- **Canvas app payloads (`CanvasApps/`)** – stores each `.msapp` along with metadata blobs (background image streams and identity JSON). 
- **Power Automate flows (`Workflows/`)** – JSON definitions for automation such as `PMflow`, `UploadLogo`, `Replybrary_GetExchangeRate`, reminder flows, etc. The `<Workflows>` block in `customizations.xml` tells you which file maps to which logical flow.
- **Environment variables (`environmentvariabledefinitions/`)** – 16 definitions that hold SharePoint site URLs, list GUIDs, links, SME/skilling tables, etc. 

### Data sources and connectors
- Both apps talk primarily to SharePoint (`shared_sharepointonline`). Lists referenced include project, client, people, lessons learned, reusable ideas, certifications, SMEs, and admin metadata, all pointing to `https://wmreplyukdev.sharepoint.com/sites/ReplybraryDev`.
- Logic Apps/Power Automate connectors (`shared_logicflows`) expose two child flows to the apps: `PMflow` (project-management automation) and `UploadLogo` (file handling).
- Additional packaged connection references cover Office 365 Users/Groups and Microsoft Teams for richer profile/context lookups once the app is imported to an environment.

### How we would parse this
1. **Inspect manifest files**\
   - Parse `solution.xml` for publisher info and component IDs.
   - Parse `customizations.xml` to see every dependency (flows, connectors, environment variables) before digging into subfolders.
2. **Parse the canvas apps**\
   - Convert each `.msapp` into unpacked folder so we can parse YAML for screens, components, media, and the Power Fx formulas driving the UI.
3. **Parse Power Automate flows**\
   - Each entry in `Workflows/*.json` uses the standard Cloud Flow schema which we can parse
4. **Map environment variables**\
   - Every folder under `environmentvariabledefinitions/` contains an `environmentvariabledefinition.xml` outlining schema name, data type, and default value.
   - We need to map these correctly before parsing them