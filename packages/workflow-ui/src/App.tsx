import { useState, useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { ModulePanel } from "./components/ModulePanel";
import { PropertyPanel } from "./components/PropertyPanel";
import { ExecutionPanel } from "./components/ExecutionPanel";
import { WorkflowList } from "./components/WorkflowList";
import { OnboardingGuide } from "./components/OnboardingGuide";
import { HelpCenter } from "./components/HelpCenter";
import { CrewEditor } from "./components/CrewEditor";
import { CredentialsPanel } from "./components/CredentialsPanel";
import { useWorkflowStore } from "./stores/workflow-store";
import type { ExecutionResult } from "./api/client";

const ONBOARDING_KEY = "openclaw-workflow-onboarded";

export function App() {
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [showWorkflowList, setShowWorkflowList] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [crewEditorNodeId, setCrewEditorNodeId] = useState<string | null>(null);

  // Show onboarding on first visit
  useEffect(() => {
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      setShowGuide(true);
    }
  }, []);

  const handleCloseGuide = () => {
    setShowGuide(false);
    localStorage.setItem(ONBOARDING_KEY, "true");
  };

  return (
    <ReactFlowProvider>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw" }}>
        <Toolbar
          onExecutionResult={setExecutionResult}
          onOpenList={() => setShowWorkflowList(true)}
          onOpenGuide={() => setShowGuide(true)}
          onOpenHelp={() => setShowHelp(true)}
          onOpenCredentials={() => setShowCredentials(true)}
        />
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <ModulePanel />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <Canvas onNodeDoubleClick={(nodeId, moduleType) => {
                if (moduleType === "crew") setCrewEditorNodeId(nodeId);
              }} />
            </div>
            {executionResult && (
              <ExecutionPanel result={executionResult} onClose={() => setExecutionResult(null)} />
            )}
          </div>
          <PropertyPanel />
        </div>
      </div>

      <WorkflowList open={showWorkflowList} onClose={() => setShowWorkflowList(false)} />
      <OnboardingGuide open={showGuide} onClose={handleCloseGuide} />
      <HelpCenter open={showHelp} onClose={() => setShowHelp(false)} />
      <CredentialsPanel open={showCredentials} onClose={() => setShowCredentials(false)} />
      <CrewEditor
        open={crewEditorNodeId !== null}
        onClose={() => setCrewEditorNodeId(null)}
        onSave={(config) => {
          if (crewEditorNodeId) {
            useWorkflowStore.getState().updateNodeData(crewEditorNodeId, { config });
          }
          setCrewEditorNodeId(null);
        }}
      />
    </ReactFlowProvider>
  );
}
