import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
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

const protect = (node: JSX.Element, bare = false) => (
  <ProtectedRoute>
    <AppLayout bare={bare}>{node}</AppLayout>
  </ProtectedRoute>
);

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
            <Route path="/dashboard" element={protect(<Dashboard />)} />
            <Route path="/senders" element={protect(<Senders />)} />
            <Route path="/contacts" element={protect(<Contacts />)} />
            <Route path="/files" element={protect(<Files />)} />
            <Route path="/sequences" element={protect(<Sequences />)} />
            <Route path="/sequences/:id" element={protect(<SequenceCanvas />, true)} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
