import { SubsystemHealth, SubsystemStatus, SystemHealthMonitor } from "../utils/health";

const BADGE_CLASS: Record<SubsystemStatus, string> = {
  healthy: "status-healthy",
  warning: "status-warning",
  recovering: "status-warning",
  error: "status-error"
};

/**
 * Staff-only alert at the top of the screen: appears whenever the camera or MediaPipe is not
 * healthy (failed to start, disconnected, recovering), so a silent failure can't go unnoticed.
 * Dismissing hides it until another subsystem fails, or everything recovers and then fails again.
 */
export function mountHealthWidget(monitor: SystemHealthMonitor): void {
  const widget = document.getElementById("health-widget")!;
  const list = document.getElementById("subsystem-list")!;
  let currentKey = "";
  let dismissedKey = "";

  document.getElementById("health-dismiss-btn")!.addEventListener("click", () => {
    dismissedKey = currentKey;
    widget.style.display = "none";
  });

  monitor.subscribe((healths) => {
    // Keyed on which subsystems have a problem, not their exact status: a retry loop flips between
    // "error" and "recovering" every few seconds and must not keep re-opening a dismissed widget
    const problems = healths.filter((h) => h.status !== "healthy");
    currentKey = problems.map((h) => h.name).join("|");
    if (problems.length === 0) dismissedKey = ""; // everything recovered: the next failure shows again
    widget.style.display = problems.length > 0 && currentKey !== dismissedKey ? "block" : "none";
    list.replaceChildren(...healths.map(renderRow));
  });
}

function renderRow(health: SubsystemHealth): HTMLElement {
  const row = document.createElement("div");
  row.className = "subsystem-item";

  const text = document.createElement("div");
  const name = document.createElement("div");
  name.textContent = health.name;
  const message = document.createElement("div");
  message.className = "subsystem-message";
  message.textContent = health.message;
  text.append(name, message);

  const badge = document.createElement("span");
  badge.className = `subsystem-badge ${BADGE_CLASS[health.status]}`;
  badge.textContent = health.status;

  row.append(text, badge);
  return row;
}
