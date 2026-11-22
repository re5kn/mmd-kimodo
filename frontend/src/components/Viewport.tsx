import { useEffect, useRef, useState } from 'react';
import { MmdViewer } from '../viewer/MmdViewer';

interface Props {
  onReady: (viewer: MmdViewer | null) => void;
  onDropFiles: (dt: DataTransfer) => void;
  empty: boolean;
}

export function Viewport({ onReady, onDropFiles, empty }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const viewer = new MmdViewer(hostRef.current!);
    onReady(viewer);
    return () => {
      onReady(null);
      viewer.dispose();
    };
  }, [onReady]);

  return (
    <div
      className={`viewport${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDropFiles(e.dataTransfer);
      }}
    >
      <div ref={hostRef} className="viewport-canvas" />
      {empty && (
        <div className="viewport-hint">
          左の「モデル読込」から PMX（または ZIP / フォルダ）を開くか、ここにドラッグ&ドロップしてください
        </div>
      )}
    </div>
  );
}
