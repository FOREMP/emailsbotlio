import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Send, Menu, X, LogOut, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const Header = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
            <Send className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Botlio Email
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Home
          </Link>
          <Link to="/pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Pricing
          </Link>
          <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Features
          </a>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-muted-foreground truncate max-w-[180px]">{user.email}</span>
              <Button size="sm" onClick={() => navigate("/dashboard")} className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
                <LayoutDashboard className="h-4 w-4 mr-1.5" /> Dashboard
              </Button>
              <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/"); }}>
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>
                Log in
              </Button>
              <Button size="sm" onClick={() => navigate("/auth")} className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
                Get Started
              </Button>
            </>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-3">
          <Link to="/" className="block text-sm font-medium py-2" onClick={() => setMobileOpen(false)}>Home</Link>
          <Link to="/pricing" className="block text-sm font-medium py-2" onClick={() => setMobileOpen(false)}>Pricing</Link>
          {user ? (
            <>
              <Button className="w-full gradient-primary border-0 text-primary-foreground" onClick={() => { setMobileOpen(false); navigate("/dashboard"); }}>
                Dashboard
              </Button>
              <Button variant="outline" className="w-full" onClick={async () => { setMobileOpen(false); await signOut(); navigate("/"); }}>
                Log out
              </Button>
            </>
          ) : (
            <Button className="w-full gradient-primary border-0 text-primary-foreground" onClick={() => { setMobileOpen(false); navigate("/auth"); }}>
              Get Started
            </Button>
          )}
        </div>
      )}
    </header>
  );
};

export default Header;
