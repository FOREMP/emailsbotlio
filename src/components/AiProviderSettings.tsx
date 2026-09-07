import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Provider = "nvidia" | "openrouter";

export function AiProviderSettings() {
  const queryClient = useQueryClient();
  const provider = useQuery({
    queryKey: ["ai-primary-provider"],
    queryFn: async (): Promise<Provider> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ai_primary_provider")
        .maybeSingle();
      if (error) throw error;
      const value = data?.value as { provider?: string } | null;
      return value?.provider === "nvidia" ? "nvidia" : "openrouter";
    },
  });

  const save = useMutation({
    mutationFn: async (next: Provider) => {
      const { error } = await supabase.from("app_settings").upsert({
        key: "ai_primary_provider",
        value: { provider: next },
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["ai-primary-provider"], next);
      toast.success(next === "nvidia" ? "NVIDIA is now primary" : "OpenRouter is now primary");
    },
    onError: (error) => toast.error(`Could not change AI provider: ${(error as Error).message}`),
  });

  const active = provider.data ?? "openrouter";
  return (
    <div className="rounded-xl border border-border bg-card shadow-card p-6 mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Cpu className="h-4 w-4" /> Website & audit AI</h2>
          <p className="text-sm text-muted-foreground mt-1">
            NVIDIA can build, classify and audit. OpenRouter is always the automatic fallback.
          </p>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Email sending and Swedish GPT copy finishing are not changed by this switch.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={active === "nvidia" ? "default" : "outline"}
            disabled={provider.isLoading || save.isPending}
            onClick={() => save.mutate("nvidia")}
          >NVIDIA primary</Button>
          <Button
            variant={active === "openrouter" ? "default" : "outline"}
            disabled={provider.isLoading || save.isPending}
            onClick={() => save.mutate("openrouter")}
          >OpenRouter primary</Button>
        </div>
      </div>
    </div>
  );
}

