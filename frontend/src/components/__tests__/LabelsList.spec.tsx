import React from 'react';
import { render, screen } from '@testing-library/react';
import LabelsList from '../LabelsList';

describe('LabelsList', () => {
  it('renders dash for empty labels', () => {
    render(<LabelsList labels={{}} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders dash for undefined labels', () => {
    render(<LabelsList />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders label chips with key=value format', () => {
    render(<LabelsList labels={{ team: 'ml', env: 'prod' }} />);
    expect(screen.getByText('team=ml')).toBeInTheDocument();
    expect(screen.getByText('env=prod')).toBeInTheDocument();
  });

  it('renders a single label', () => {
    render(<LabelsList labels={{ app: 'agent' }} />);
    expect(screen.getByText('app=agent')).toBeInTheDocument();
  });
});
