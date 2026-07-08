import { useMemo } from "react";
import CommandPanel from "./CommandPanel";
import MobileSnapshotBar from "./MobileSnapshotBar";
import { deriveEstimateCockpitReadiness } from "./estimateCockpitReadiness";
import "./CockpitShell.css";

export default function CockpitShell({ children, desiredDocType = "estimate", snapshot = null }) {
  const readiness = useMemo(() => {
    if (!snapshot?.state) return null;
    return deriveEstimateCockpitReadiness(snapshot.state, snapshot);
  }, [snapshot]);

  const isAwaitingLiveSnapshot = !snapshot?.isLive;

  return (
    <div className="pe-cockpit-shell">
      <div className="pe-cockpit-shell__frame">
        <div className="pe-cockpit-shell__builder">{children}</div>
        <div className="pe-cockpit-shell__desktop-rail">
          <CommandPanel
            desiredDocType={desiredDocType}
            totals={snapshot}
            readiness={readiness}
            isAwaitingLiveSnapshot={isAwaitingLiveSnapshot}
          />
        </div>
      </div>
      <MobileSnapshotBar
        desiredDocType={desiredDocType}
        totals={snapshot}
        readiness={readiness}
        isAwaitingLiveSnapshot={isAwaitingLiveSnapshot}
      />
    </div>
  );
}
