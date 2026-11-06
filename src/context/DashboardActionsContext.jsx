import { createContext, createSignal, useContext } from 'solid-js';

const DashboardActionsContext = createContext();

export function DashboardActionsProvider(props) {
  const [registered, setRegistered] = createSignal({});
  const value = {
    items: () => Object.values(registered()).flat(),
    register: (id, items) => setRegistered((previous) => ({ ...previous, [id]: items })),
    remove: (id) =>
      setRegistered((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      }),
  };
  return (
    <DashboardActionsContext.Provider value={value}>
      {props.children}
    </DashboardActionsContext.Provider>
  );
}

export const useDashboardActions = () => useContext(DashboardActionsContext);
