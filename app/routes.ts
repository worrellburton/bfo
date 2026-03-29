import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("frameworks", "routes/frameworks.tsx"),
    route("assets", "routes/assets.tsx"),
    route("assets/:id", "routes/asset-detail.tsx"),
    route("notes", "routes/notes.tsx"),
    route("agents", "routes/agents.tsx"),
    route("agents/:id", "routes/agent-chat.tsx"),
    route("office", "routes/office.tsx"),
    route("tools", "routes/calculations.tsx"),
    route("tools/developer-payment", "routes/calc-dev-payment.tsx"),
    route("tools/property-analysis", "routes/calc-property-analysis.tsx"),
    route("tools/fdj-hesperia", "./routes/fdj-hesperia.tsx"),
  ]),
] satisfies RouteConfig;
