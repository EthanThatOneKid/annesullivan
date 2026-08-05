export type CaptionCue = {
  startTime: number;
  endTime: number;
  text: string;
};

export type AudioTrackInfo = {
  index: number;
  id: string;
  kind: string;
  label: string;
  language: string;
  enabled: boolean;
};

export type MediaInspection = {
  name: string;
  type: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  captions: CaptionCue[];
  audioTracks: AudioTrackInfo[];
  canCaptureStream: boolean;
};
