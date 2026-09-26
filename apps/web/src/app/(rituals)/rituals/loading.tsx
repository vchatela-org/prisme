import { LoadingState } from '@prisme/ui';

export default function RitualsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-ink">Rituals</h1>
      <LoadingState rows={5} label="Loading the rituals" />
    </div>
  );
}
