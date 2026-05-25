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
import { useModulesStore } from "./stores/modules-store";

const ONBOARDING_KEY = "openclaw-workflow-onboarded";

export function App() {
  const [showWorkflowList, setShowWorkflowList] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [crewEditorNodeId, setCrewEditorNodeId] = useState<string | null>(null);
  const loadModules = useModulesStore((s) => s.load);

  useEffect(() => {
    void loadModules();
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      setShowGuide(true);
    }
  }, [loadModules]);

  const handleCloseGuide = () => {
    setShowGuide(false);
    localStorage.setItem(ONBOARDING_KEY, "true");
  };

  return (
    <ReactFlowProvider>
      <div className="app-shell">
        <Toolbar
          onOpenList={() => setShowWorkflowList(true)}
          onOpenGuide={() => setShowGuide(true)}
          onOpenHelp={() => setShowHelp(true)}
          onOpenCredentials={() => setShowCredentials(true)}
        />

        <div className="app-main">
          <ModulePanel />

          <div className="canvas-area">
            <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
              <Canvas
                onNodeDoubleClick={(nodeId, moduleType) => {
                  if (moduleType === "crew") setCrewEditorNodeId(nodeId);
                }}
              />
            </div>
            <ExecutionPanel />
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
