import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

// So sánh một trường với trường khác trong cùng DTO.
export function MatchProperty(property: string, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'matchProperty',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      constraints: [property],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedProperty] = args.constraints as [string];
          return value === (args.object as Record<string, unknown>)[relatedProperty];
        },
      },
    });
  };
}
