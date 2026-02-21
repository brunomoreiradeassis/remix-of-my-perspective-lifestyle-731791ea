import { useEffect, useState } from "react";
import { TopToolbar } from "@/components/builder/TopToolbar";
import { ChatPanel } from "@/components/builder/ChatPanel";
import { PreviewPanel } from "@/components/builder/PreviewPanel";
import { CodeEditor } from "@/components/builder/CodeEditor";
import { LoadingCard } from "@/components/builder/LoadingCard";
import { OllamaProvider } from "@/contexts/OllamaContext";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

function AppShell() {
  const [view, setView] = useState<"preview" | "code">("preview");

  // Listen for file-selected event to auto-switch to code view
  useEffect(() => {
    const handler = () => setView("code");
    window.addEventListener("file-selected", handler);
    return () => window.removeEventListener("file-selected", handler);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopToolbar view={view} onViewChange={setView} />

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Chat panel */}
        <ResizablePanel defaultSize={25} minSize={15} maxSize={50}>
          <ChatPanel />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Preview / Code */}
        <ResizablePanel defaultSize={75} minSize={30}>
          {view === "preview" ? <PreviewPanel /> : <CodeEditor />}
        </ResizablePanel>
      </ResizablePanelGroup>

      <LoadingCard />
    </div>
  );
}

const Index = () => {
  return (
    <OllamaProvider>
      <AppShell />
    </OllamaProvider>
  );
};

export default Index;
