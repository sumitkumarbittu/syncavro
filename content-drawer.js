(() => {
  if (globalThis.__syncavroDrawerInstalled) return;
  globalThis.__syncavroDrawerInstalled = true;

  const WIDTH = "420px";
  const host = document.createElement("div");
  host.id = "syncavro-page-drawer-host";
  host.style.cssText = [
    "all:initial",
    "position:fixed",
    "top:0",
    "right:0",
    "width:min(420px,100vw)",
    "height:100vh",
    "z-index:2147483647",
    "transform:translateX(102%)",
    "transition:transform 220ms cubic-bezier(.2,.8,.2,1)",
    "box-shadow:-18px 0 48px rgba(0,0,0,.28)",
    "background:#000"
  ].join(";");

  const shadow = host.attachShadow({ mode: "closed" });
  const frame = document.createElement("iframe");
  frame.title = "Syncavro real-time sharing";
  frame.allow = "clipboard-read; clipboard-write";
  frame.src = chrome.runtime.getURL("sidepanel.html");
  frame.style.cssText = "display:block;border:0;width:100%;height:100%;background:#000;color-scheme:dark light";

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close Syncavro");
  close.textContent = "×";
  close.style.cssText = "all:initial;box-sizing:border-box;position:absolute;top:9px;right:9px;z-index:2;width:30px;height:30px;border-radius:9px;background:rgba(16,24,34,.92);border:1px solid rgba(125,211,252,.25);color:#dff8ff;font:22px/28px system-ui;text-align:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)";

  shadow.append(frame, close);
  (document.documentElement || document.body).append(host);

  let open = false;
  const originalBodyWidth = document.body?.style.width || "";
  const originalBodyTransition = document.body?.style.transition || "";

  function setOpen(next) {
    open = next;
    host.style.transform = open ? "translateX(0)" : "translateX(102%)";
    host.style.pointerEvents = open ? "auto" : "none";
    if (document.body) {
      document.body.style.transition = "width 220ms cubic-bezier(.2,.8,.2,1)";
      document.body.style.width = open ? `calc(100% - min(${WIDTH}, 100vw))` : originalBodyWidth;
    }
  }

  close.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (open && event.key === "Escape") setOpen(false);
  }, true);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "SYNCAVRO_TOGGLE_DRAWER") setOpen(!open);
  });
  window.addEventListener("pagehide", () => {
    if (document.body) {
      document.body.style.width = originalBodyWidth;
      document.body.style.transition = originalBodyTransition;
    }
  }, { once: true });

  setOpen(false);
})();
