Expense Tracker Sample App
==========================

What this file explains
This README explains, in beginner terms, how  to parse the Power Apps solution directory
that lives in this repository. It focuses on what files and folders to look at, what each contains,
and which parsing strategies help you extract useful information. It does not include commands to
run — only the conceptual steps and practical tips for parsing.

Fundamental pieces to inspect
-----------------------------
- `solution.xml` — the primary index for the exported solution. It lists solution components
  (component ids, types, and references). Parse it as XML to learn which components belong to this
  solution and to map GUIDs to component types.
- `customizations.xml` — contains form and view customizations and sometimes component-level
  customization metadata. Also XML; useful for understanding how entities/forms are tailored.
- `CanvasApps/` — contains canvas app packages. These appear as `.msapp` files or unpacked
  folders. A canvas app package contains the app manifest, screens, controls, resources, and
  Power Fx expressions.
- `botcomponents/` — bot topics and related assets. These are usually stored as folders with
  topic files, JSON, or plaintext — read them directly to understand bot flows and responses.
- `Assets/` — images, templates, or additional files referenced by apps and bots.
- `Workflows/` — exported flow/Power Automate definitions and related metadata.
- `environmentvariabledefinitions/` — definitions of environment variables used by apps and flows.

High-level parsing approach 
----------------------------------------
1. Inventory the tree: walk the solution directory and record top-level files and folders. This
   gives you a map of where apps, bots, flows, and assets live.

2. Parse solution metadata: open `solution.xml` (XML). Look for component entries (they often
   contain element names like `SolutionComponent`, `Component`, or `Entity`) and extract
   attributes such as `id`, `type`, and `name`. This tells you what the solution contains and
   how components relate.

3. Parse customizations: read `customizations.xml` to find form/view customizations and
   component-specific settings. This helps when you need to match component IDs to UI or data
   customizations.

4. Inspect Canvas apps: for each canvas app found under `CanvasApps/`:
   - The canonical approach is to unpack the `.msapp` into a source tree (manifest + JSON
     files). Once unpacked, you can search JSON files for screens, controls, and Power Fx
     expressions.
   - If the app is already an unpacked folder, look for `manifest.json`, `Screen.*.json`, or
     component JSON files.

5. Inspect bots and workflows: read files under `botcomponents/` and `Workflows/`. Topics and
   flows are often JSON or XML. Search these for trigger definitions, action targets, and
   environment variable references.

6. Cross-reference IDs: use the component IDs from `solution.xml` to locate matching files in
   subfolders (canvas app manifests, workflow definitions). This mapping is often the key to
   joining metadata and concrete resources.

File types and parsers
----------------------
- XML: use a standard XML parser (e.g., Python's `xml.etree.ElementTree`) to read
  `solution.xml` and `customizations.xml` safely and extract attributes and elements.
- JSON: many unpacked canvas app files, manifests, and topic/flow definitions are JSON. Use a
  JSON parser to load and search for keys such as `Screens`, `Controls`, `manifest`, `triggers`.
- ZIP-like packages: `.msapp` files are often package formats that can be treated as zip files
  or unpacked with official tools to expose JSON and resources.

What to look for inside unpacked canvas apps
--------------------------------------------
- `manifest.json` — high-level metadata about the app.
- `Screen.*.json` — each screen's controls and nested formulas.
- `components/` and `resources/` — custom components and media.
- Power Fx expressions — usually embedded as strings inside control properties; search JSON for
  keys like `Properties`, `Formula`, or `Text` to find them.

Parsing Tips
-------------
- Start with `solution.xml` to make a guided search — it reduces blind searching by telling you
  what to expect in the folders.
- Treat `.msapp` files as packages: prefer using vendor or official unpack tools when available
  because they produce a stable, parseable structure.
- When matching IDs from `solution.xml` to files, remember GUID formats and look for them in
  file names or inside manifests.
- For Power Fx analysis, focus on unpacked JSON files and search for formula strings; Power Fx is
  embedded text, so string search plus a small parser for patterns (e.g., control references)
  helps.

Next steps 
----------
- Build a small script that: walks the directory, parses `solution.xml`, finds `.msapp` files,
  unpacks them, and indexes manifests/screens into a searchable JSON/DB for quick queries.
- Add simple heuristics to map component IDs to files and extract Power Fx expressions for
  later analysis.

