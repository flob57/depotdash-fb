import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Radio, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  clearFeedFromStorage,
  loadFeedFromStorage,
  saveFeedToStorage,
} from "@/lib/gtfs-rt";

export function GtfsRtUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<{
    count: number;
    uploadedAt: number;
    feedTs: number | null;
  } | null>(null);

  const refresh = () => {
    const f = loadFeedFromStorage();
    if (!f) {
      setInfo(null);
      return;
    }
    setInfo({
      count: f.vehicles.length,
      uploadedAt: f.uploadedAt,
      feedTs: f.feedTimestamp,
    });
  };

  useEffect(() => {
    refresh();
    const h = () => refresh();
    window.addEventListener("gtfsrt:updated", h);
    return () => window.removeEventListener("gtfsrt:updated", h);
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      // Validate by decoding
      const { decodeGtfsRt } = await import("@/lib/gtfs-rt");
      const { vehicles } = decodeGtfsRt(bytes);
      saveFeedToStorage(bytes);
      toast.success(`Flux GTFS-RT chargé (${vehicles.length} véhicules)`);
    } catch (err) {
      toast.error("Fichier GTFS-RT invalide");
      console.error(err);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const age = info ? Math.floor((Date.now() - info.uploadedAt) / 1000) : 0;
  const ageLabel = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".bin,.pb,application/octet-stream"
        className="hidden"
        onChange={onFile}
      />
      {info ? (
        <div className="flex items-center gap-1.5 text-xs">
          <Radio className="h-3.5 w-3.5 text-green-500" />
          <span className="text-muted-foreground">
            {info.count} véh. · il y a {ageLabel}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3 w-3 mr-1" />
            MAJ
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              clearFeedFromStorage();
              toast.success("Flux GTFS-RT effacé");
            }}
            title="Effacer"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3 w-3 mr-1" />
          GTFS-RT
        </Button>
      )}
    </div>
  );
}
