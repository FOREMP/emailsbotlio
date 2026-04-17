import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index.tsx";
import Pricing from "./pages/Pricing.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Senders from "./pages/Senders.tsx";
import Contacts from "./pages/Contacts.tsx";
import Files from "./pages/Files.tsx";
import Sequences from "./pages/Sequences.tsx";
import SequenceCanvas from "./pages/SequenceCanvas.tsx";
import Auth from "./pages/Auth.tsx";
import Unsubscribe from "./pages/Unsubscribe.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/senders" element={<ProtectedRoute><Senders /></ProtectedRoute>} />
            <Route path="/contacts" element={<ProtectedRoute><Contacts /></ProtectedRoute>} />
            <Route path="/files" element={<ProtectedRoute><Files /></ProtectedRoute>} />
            <Route path="/sequences" element={<ProtectedRoute><Sequences /></ProtectedRoute>} />
            <Route path="/sequences/:id" element={<ProtectedRoute><SequenceCanvas /></ProtectedRoute>} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;