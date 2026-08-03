import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  AlertActionCloseButton,
  AlertGroup,
  AlertVariant,
} from '@patternfly/react-core';

type ToastAlert = {
  id: number;
  variant: AlertVariant;
  title: string;
};

type AlertContextValue = {
  addAlert: (title: string, variant?: AlertVariant) => void;
  addSuccess: (title: string) => void;
  addDanger: (title: string) => void;
};

const AlertContext = createContext<AlertContextValue>({
  addAlert: () => undefined,
  addSuccess: () => undefined,
  addDanger: () => undefined,
});

export const useAlerts = () => useContext(AlertContext);

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [alerts, setAlerts] = useState<ToastAlert[]>([]);
  const counter = useRef(0);

  const removeAlert = useCallback((id: number) => {
    setAlerts((current) => current.filter((a) => a.id !== id));
  }, []);

  const addAlert = useCallback(
    (title: string, variant: AlertVariant = AlertVariant.info) => {
      const id = ++counter.current;
      setAlerts((current) => [...current, { id, variant, title }]);
      setTimeout(() => removeAlert(id), 6000);
    },
    [removeAlert],
  );

  const addSuccess = useCallback(
    (title: string) => addAlert(title, AlertVariant.success),
    [addAlert],
  );

  const addDanger = useCallback(
    (title: string) => addAlert(title, AlertVariant.danger),
    [addAlert],
  );

  return (
    <AlertContext.Provider value={{ addAlert, addSuccess, addDanger }}>
      {children}
      <AlertGroup isToast isLiveRegion aria-label="Notifications">
        {alerts.map((alert) => (
          <Alert
            key={alert.id}
            variant={alert.variant}
            title={alert.title}
            timeout={6000}
            actionClose={
              <AlertActionCloseButton onClose={() => removeAlert(alert.id)} />
            }
          />
        ))}
      </AlertGroup>
    </AlertContext.Provider>
  );
};
