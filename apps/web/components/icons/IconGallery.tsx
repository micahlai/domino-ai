import { AGENT_KIND_LABEL, AgentIcon, type AgentKind } from "./AgentIcon";
import { TOOL_CATEGORY_LABEL, type ToolCategory, ToolIcon } from "./ToolIcon";
import { ToolLogo } from "./ToolLogo";
import { VENDORS, type VendorId } from "./vendors";

/** Every icon in the set, for the playground. */
export function IconGallery() {
  const group = "flex flex-wrap gap-x-6 gap-y-3 rounded-xl border bg-card p-4";
  const item = "inline-flex items-center gap-2 text-sm";
  return (
    <div className="space-y-3">
      <div className={group}>
        {(Object.keys(VENDORS) as VendorId[]).map((id) => (
          <span key={id} className={item}>
            <ToolLogo vendor={id} size={28} />
            {VENDORS[id].name}
          </span>
        ))}
      </div>
      <div className={group}>
        {(Object.keys(AGENT_KIND_LABEL) as AgentKind[]).map((kind) => (
          <span key={kind} className={item}>
            <AgentIcon kind={kind} size={28} />
            {AGENT_KIND_LABEL[kind]}
          </span>
        ))}
      </div>
      <div className={group}>
        {(Object.keys(TOOL_CATEGORY_LABEL) as ToolCategory[]).map((category) => (
          <span key={category} className={item}>
            <ToolIcon category={category} tile size={28} />
            {TOOL_CATEGORY_LABEL[category]}
          </span>
        ))}
      </div>
    </div>
  );
}
