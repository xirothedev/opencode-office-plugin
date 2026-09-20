---
"@xirothedev/openoffice-plugin-opencode": major
---

Migrate to GA opencode plugin registry pins (`@opencode/plugin@2.0.10`, `@opencode/schema@2.0.10`, `effect@4.0.0-rc.112`), delete the `file:./vendor` checkout, and import `Plugin.define` from `@opencode/plugin/effect`. Breaking for hosts on the beta plugin line — upgrade the host together with the plugin (ADR-0016).
