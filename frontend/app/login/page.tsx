import LoginForm from '../ui/LoginForm';
import { LoginChrome } from '../ui/AuthChrome';

export default function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <LoginChrome />
        <LoginForm />
      </div>
    </div>
  );
}
