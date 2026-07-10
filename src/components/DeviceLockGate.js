import { useEffect, useMemo, useState } from "react";
import {
  DEVICE_LOCK_EXPLANATION,
  DEVICE_LOCK_POST_SWITCH_WARNING,
} from "../lib/supabaseDeviceLock";

const overlayStyle = {
  minHeight: "calc(100dvh - 140px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px 12px",
  boxSizing: "border-box",
};

const cardStyle = {
  width: "min(620px, 100%)",
  display: "grid",
  gap: 16,
  padding: "24px 20px",
  borderRadius: 22,
  border: "1px solid rgba(245,158,11,0.22)",
  background: "linear-gradient(180deg, rgba(18,27,38,0.96), rgba(7,11,18,0.95))",
  boxShadow: "0 28px 60px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.04)",
};

const pillStyle = {
  display: "inline-flex",
  alignItems: "center",
  width: "fit-content",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(245,158,11,0.28)",
  background: "rgba(245,158,11,0.08)",
  color: "rgba(253,224,71,0.95)",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.58)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalCardStyle = {
  width: "min(560px, 100%)",
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(10,10,10,0.9)",
  boxShadow: "0 18px 46px rgba(0,0,0,0.48)",
  padding: 18,
  display: "grid",
  gap: 14,
};

function LineList({ lines }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {lines.map((line) => (
        <div
          key={line}
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: "rgba(220,229,238,0.76)",
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

export default function DeviceLockGate({
  deviceLock,
  onSignOut,
  onRestoreCloudData,
  onOpenAdvancedSettings,
  children,
} = {}) {
  const [showTakeoverConfirm, setShowTakeoverConfirm] = useState(false);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [takeoverError, setTakeoverError] = useState("");
  const [showPostSwitch, setShowPostSwitch] = useState(false);

  useEffect(() => {
    if (!deviceLock?.isLocked) {
      setShowTakeoverConfirm(false);
      setTakeoverError("");
    }
  }, [deviceLock?.isLocked]);

  const activeDeviceName = useMemo(() => {
    const value = String(deviceLock?.activeDeviceState?.activeDeviceName || "").trim();
    return value || "another device";
  }, [deviceLock?.activeDeviceState?.activeDeviceName]);

  if (deviceLock?.loading && !deviceLock?.ready) {
    return (
      <div style={overlayStyle}>
        <div style={{ ...cardStyle, maxWidth: 420, justifyItems: "center", textAlign: "center" }}>
          <div style={pillStyle}>Checking Device</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "rgba(240,246,250,0.98)" }}>
            Checking Device Access
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "rgba(210,220,229,0.74)" }}>
            EstiPaid is confirming whether this device is the active editing device for this workspace.
          </div>
        </div>
      </div>
    );
  }

  if (showPostSwitch) {
    return (
      <div style={overlayStyle}>
        <div style={cardStyle}>
          <div style={pillStyle}>Device switched</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: "rgba(247,250,252,0.98)", lineHeight: 1.05 }}>
              Device Switched
            </div>
            <LineList
              lines={[
                "This device is now active.",
                "The other device has been locked from editing and cloud saving.",
                DEVICE_LOCK_POST_SWITCH_WARNING,
              ]}
            />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="pe-btn"
              onClick={() => {
                setShowPostSwitch(false);
                onRestoreCloudData?.();
              }}
            >
              Restore Cloud Data
            </button>
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onClick={() => {
                setShowPostSwitch(false);
                onOpenAdvancedSettings?.();
              }}
            >
              Go to Advanced Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (deviceLock?.isLocked) {
    const handleTakeover = async () => {
      if (takeoverBusy || typeof deviceLock?.takeover !== "function") return;
      setTakeoverBusy(true);
      setTakeoverError("");
      try {
        const result = await deviceLock.takeover();
        if (!result?.ok) {
          setTakeoverError(String(result?.state?.error || "Unable to switch devices right now."));
          return;
        }
        setShowTakeoverConfirm(false);
        setShowPostSwitch(true);
      } finally {
        setTakeoverBusy(false);
      }
    };

    return (
      <>
        <div style={overlayStyle}>
          <div style={cardStyle}>
            <div style={pillStyle}>Device locked</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: "rgba(247,250,252,0.98)", lineHeight: 1.05 }}>
                This Device Is Locked
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(219,229,236,0.8)" }}>
                This device is now locked to protect your estimates, invoices, and customer records.
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(219,229,236,0.8)" }}>
                Your EstiPaid account is already active on another device, so editing and cloud saving are locked here.
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(219,229,236,0.8)" }}>
                To continue here, switch EstiPaid back to this device. Before switching, make sure your latest work was saved to cloud from the other device.
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, padding: "14px 14px 12px", borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(253,224,71,0.88)" }}>
                What happens when you switch
              </div>
              <LineList
                lines={[
                  "This device becomes active.",
                  "The other device is locked from editing and cloud saving.",
                  "You may need to restore the latest cloud backup here before working.",
                ]}
              />
            </div>

            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "rgba(179,194,205,0.72)" }}>
              Active on: {activeDeviceName}
            </div>

            {takeoverError ? (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "rgba(248,113,113,0.96)" }}>
                {takeoverError}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="pe-btn"
                onClick={() => setShowTakeoverConfirm(true)}
                disabled={takeoverBusy}
              >
                Switch to This Device
              </button>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => onSignOut?.()}
                disabled={takeoverBusy}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        {showTakeoverConfirm ? (
          <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-label="Switch EstiPaid to This Device?">
            <div style={modalCardStyle}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "rgba(247,250,252,0.98)", lineHeight: 1.1 }}>
                Switch EstiPaid to This Device?
              </div>
              <LineList
                lines={[
                  "EstiPaid is already active on another device. Switching here will lock the other device from editing and cloud saving.",
                  "Before continuing, make sure your latest work was saved to cloud from the other device. Any work that was not saved to cloud may not appear here.",
                ]}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost"
                  onClick={() => setShowTakeoverConfirm(false)}
                  disabled={takeoverBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pe-btn"
                  onClick={handleTakeover}
                  disabled={takeoverBusy}
                >
                  {takeoverBusy ? "Switching..." : "Switch Device"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return children;
}

export { DEVICE_LOCK_EXPLANATION };
