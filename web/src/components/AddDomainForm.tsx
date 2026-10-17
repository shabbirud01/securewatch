import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { Button, ErrorMessage, Spinner } from './ui';

/**
 * Adds a domain. The hostname rules live on the server only (one set of rules for the
 * API and the UI), so this form simply shows the server's message when it says no.
 */
export function AddDomainForm() {
  const queryClient = useQueryClient();
  const [hostname, setHostname] = useState('');

  const add = useMutation({
    mutationFn: api.addDomain,
    onSuccess: () => {
      setHostname('');
      return queryClient.invalidateQueries({ queryKey: ['domains'] });
    },
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate(hostname.trim());
      }}
    >
      <label htmlFor="new-domain" className="block text-sm font-medium">
        Add a domain to monitor
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="new-domain"
          value={hostname}
          onChange={(event) => {
            setHostname(event.target.value);
            add.reset(); // clear the previous error while typing
          }}
          placeholder="example.com, example.com:8443, or paste a URL"
          autoComplete="off"
          spellCheck={false}
          maxLength={300}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-series-1"
        />
        <Button type="submit" variant="primary" disabled={add.isPending || hostname.trim() === ''}>
          {add.isPending && <Spinner />}
          Add domain
        </Button>
      </div>
      {add.isError && <ErrorMessage error={add.error} />}
    </form>
  );
}
