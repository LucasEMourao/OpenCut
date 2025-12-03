import { MediaElement } from "@/types/timeline";

export function MediaProperties({ element }: { element: MediaElement }) {
  return (
    <div className="space-y-4 p-5">
      <h3 className="font-medium truncate text-sm" title={element.name}>
        {element.name || "Untitled Clip"}
      </h3>
    </div>
  );
}
